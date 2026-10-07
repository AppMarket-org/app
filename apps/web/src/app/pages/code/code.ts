import { RepositoryHeader } from '../../components/repository-header/repository-header';
import { BreakpointObserver } from '@angular/cdk/layout';
import { Clipboard } from '@angular/cdk/clipboard';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RepositoryNav } from '../../components/repository-nav/repository-nav';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { Markdown } from '../../components/markdown/markdown';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Seo } from '../../seo/seo';
import { languageFor } from './languages';
import { CodeExplorer, type FileNode } from './explorer/explorer';
import { CodeGraphPanel, GRAPHED_FILE } from '../../components/code-graph-panel/code-graph-panel';

interface CodeTree {
  ref: string;
  commit: string | null;
  path: string;
  editor: boolean;
  empty?: boolean;
  entries: { name: string; type: 'tree' | 'blob' | 'link' }[];
}
interface CodeFile {
  path: string;
  size: number;
  binary: boolean;
  tooLarge: boolean;
  text: string | null;
}

/**
 * Read-only code browser. The published version for everyone; any branch for owners and
 * members. Highlighting runs in the browser with Shiki, loaded (with each language) on demand.
 */
@Component({
  selector: 'app-code',
  host: { '[class.embedded]': 'embedded()' },
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    RouterLink,
    CodeExplorer,
    CodeGraphPanel,
    MatButtonToggleModule,
    Markdown,
    RepositoryNav,
    RepositoryHeader,
    NgTemplateOutlet,
  ],
  templateUrl: './code.html',
  styleUrl: './code.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodePage {
  readonly embedded = input(false);
  protected readonly readme = signal<CodeFile | null>(null);
  protected readonly readmeLoading = signal(false);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly clipboard = inject(Clipboard);
  private readonly snackBar = inject(MatSnackBar);
  private readonly route = inject(ActivatedRoute);
  protected readonly owner = this.route.snapshot.paramMap.get('owner') ?? '';
  protected readonly slug = this.route.snapshot.paramMap.get('slug') ?? '';
  protected readonly full = `${this.owner}/${this.slug}`;
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** Legacy directory links are expanded in the explorer on arrival. */
  protected readonly dir = computed(() => this.query().get('path') ?? '');
  protected readonly preview = signal(true);
  protected readonly markdown = computed(() => /\.(md|markdown)$/i.test(this.file() ?? ''));
  protected readonly file = computed(() => this.query().get('file'));
  protected readonly ref = computed(() => this.query().get('ref'));
  private shownKey = '';
  /** A line to show (from the code graph panel): scrolled to and marked. */
  protected readonly line = computed(() => Number(this.query().get('line')) || null);
  /** #240: the code graph panel beside code files the graph indexes (owners and members). */
  protected readonly graphPanel = computed(() => !!this.tree()?.editor && !!this.file() && GRAPHED_FILE.test(this.file()!) && !this.markdown());

  protected readonly tree = signal<CodeTree | null | undefined>(undefined);
  protected readonly blob = signal<CodeFile | null>(null);
  protected readonly html = signal<SafeHtml | null>(null);
  protected readonly loading = signal(false);
  protected readonly branches = signal<string[]>([]);
  protected readonly tags = signal<string[] | null>(null);

  constructor() {
    const seo = inject(Seo);
    effect(() => { if (!this.embedded()) seo.set({
      title: `Code · ${this.full}`,
      description: `Source code of ${this.full}.`,
      path: `/${this.full}/code`,
      noindex: true,
      heading: [
        { label: this.owner, link: `/${this.owner}` },
        { label: this.slug, link: `/${this.full}` },
        { label: 'Code' },
      ],
    }); });
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      // Only the line changed (the code graph panel): scroll, without loading the file again.
      const key = `${q.get('ref')}\n${q.get('file')}`;
      if (key === this.shownKey && this.html()) return this.showLine(this.line());
      this.shownKey = key;
      void this.load();
    });
  }

  protected readonly nodes = signal<FileNode[]>([]);
  protected readonly files = signal<string[]>([]);
  protected readonly indexing = signal(false);
  protected readonly indexError = signal(false);
  protected readonly complete = signal(true);
  protected readonly switching = signal(false);
  protected readonly fileError = signal(false);
  protected readonly showFiles = signal(true);
  private readonly compact = toSignal(inject(BreakpointObserver).observe('(max-width: 48rem)'), {
    initialValue: { matches: false, breakpoints: {} },
  });
  private loadedRef: string | null | undefined = undefined;
  private generation = 0;
  private request = 0;
  private indexed = false;
  private rootPending: Promise<void> | null = null;

  protected chooseRef(ref: string): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ref, file: this.file() },
    });
  }

  protected openFile(file: string): void {
    if (this.compact().matches) this.showFiles.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { ref: this.ref(), file },
    });
  }

  protected openLine(line: number): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ref: this.ref(), file: this.file(), line } });
  }

  /** Scrolls the highlighted code to a line and marks it. */
  private showLine(line: number | null): void {
    if (!line) return;
    setTimeout(() => {
      const lines = document.querySelectorAll('.viewer .code .line');
      lines.forEach((el) => el.classList.remove('marked'));
      const el = lines[line - 1];
      el?.classList.add('marked');
      el?.scrollIntoView({ block: 'center' });
    });
  }

  protected closeFile(): void {
    this.showFiles.set(true);
    void this.router.navigate([], { relativeTo: this.route, queryParams: { ref: this.ref() } });
  }

  protected copy(): void {
    const text = this.blob()?.text;
    if (text != null)
      this.snackBar.open(this.clipboard.copy(text) ? 'Copied' : 'Copy failed', undefined, {
        duration: 2000,
      });
  }

  private get base(): string {
    return `/api/repos/${this.full}/code`;
  }
  private revision(): Record<string, string> {
    const t = this.tree();
    const ref = t?.editor ? t.commit : t?.ref;
    return ref ? { ref } : {};
  }
  private entries(tree: CodeTree): FileNode[] {
    return [...tree.entries]
      .sort(
        (a, b) =>
          Number(b.type === 'tree') - Number(a.type === 'tree') || a.name.localeCompare(b.name),
      )
      .map((e) => ({ ...e, path: [tree.path, e.name].filter(Boolean).join('/') }));
  }

  protected async toggle(node: FileNode): Promise<void> {
    if (node.expanded && !node.error) {
      node.expanded = false;
      this.nodes.update((nodes) => [...nodes]);
      return;
    }
    node.expanded = true;
    if (!node.children && !node.loading) await this.expand(node);
    this.nodes.update((nodes) => [...nodes]);
  }

  private async expand(node: FileNode): Promise<void> {
    const generation = this.generation;
    node.loading = true;
    node.error = false;
    this.nodes.update((nodes) => [...nodes]);
    try {
      const tree = await firstValueFrom(
        this.http.get<CodeTree>(`${this.base}/tree`, {
          params: { ...this.revision(), path: node.path },
        }),
      );
      if (generation === this.generation) node.children = this.entries(tree);
    } catch {
      if (generation === this.generation) node.error = true;
    } finally {
      node.loading = false;
      if (generation === this.generation) this.nodes.update((nodes) => [...nodes]);
    }
  }

  protected async searchFiles(): Promise<void> {
    if (this.indexed || this.indexing() || !this.tree()?.commit) return;
    const generation = this.generation;
    this.indexing.set(true);
    this.indexError.set(false);
    try {
      const index = await firstValueFrom(
        this.http.get<{ files: string[]; complete: boolean }>(`${this.base}/files`, {
          params: this.revision(),
        }),
      );
      if (generation !== this.generation) return;
      this.files.set(index.files);
      this.complete.set(index.complete);
      this.indexed = true;
    } catch {
      if (generation === this.generation) this.indexError.set(true);
    } finally {
      if (generation === this.generation) this.indexing.set(false);
    }
  }

  private async reveal(path: string, generation: number): Promise<void> {
    let nodes = this.nodes();
    const parts = path.split('/');
    for (const part of parts.slice(0, -1)) {
      if (generation !== this.generation) return;
      const node = nodes.find((n) => n.name === part && n.type === 'tree');
      if (!node) return;
      node.expanded = true;
      if (!node.children) await this.expand(node);
      nodes = node.children ?? [];
    }
    if (generation === this.generation) this.nodes.update((nodes) => [...nodes]);
  }

  private async loadRoot(ref: string | null): Promise<void> {
    const generation = ++this.generation;
    this.loadedRef = ref;
    this.switching.set(true);
    this.tags.set(null);
    this.files.set([]);
    this.indexed = false;
    this.indexing.set(false);
    this.indexError.set(false);
    this.complete.set(true);
    const tree = await firstValueFrom(
      this.http.get<CodeTree>(`${this.base}/tree`, { params: ref ? { ref } : {} }),
    ).catch(() => null);
    if (generation !== this.generation) return;
    this.tree.set(tree);
    this.nodes.set(tree ? this.entries(tree) : []);
    this.readme.set(null);
    const readme = tree?.entries.find((entry) => entry.type !== 'tree' && /^readme\.(md|markdown)$/i.test(entry.name));
    this.readmeLoading.set(!!readme);
    if (readme && tree?.commit) {
      void firstValueFrom(this.http.get<CodeFile>(`${this.base}/blob`, {
        params: { ...this.revision(), path: readme.name },
      })).then((file) => {
        if (generation === this.generation) this.readme.set(file);
      }).catch(() => {}).finally(() => {
        if (generation === this.generation) this.readmeLoading.set(false);
      });
    }
    if (tree?.editor) {
      const b = await firstValueFrom(
        this.http.get<{ branches: string[]; tags?: string[] }>(`${this.base}/branches`),
      ).catch(() => null);
      if (generation === this.generation) {
        this.branches.set(b?.branches ?? []);
        this.tags.set(b?.tags ?? null);
      }
    } else this.branches.set([]);
    if (this.dir()) await this.reveal(`${this.dir()}/`, generation);
    if (generation === this.generation) this.switching.set(false);
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.html.set(null);
    this.blob.set(null);
    this.fileError.set(false);
    const ref = this.ref();
    if (ref !== this.loadedRef) this.rootPending = this.loadRoot(ref);
    await this.rootPending;
    if (request !== this.request) return;
    const file = this.file();
    if (file && this.tree()?.commit) {
      void this.reveal(file, this.generation);
      const blob = await firstValueFrom(
        this.http.get<CodeFile>(`${this.base}/blob`, {
          params: { ...this.revision(), path: file },
        }),
      ).catch(() => null);
      if (request !== this.request) return;
      this.blob.set(blob);
      this.fileError.set(!blob);
      if (blob?.text != null) {
        const html = await this.highlight(blob.text, file).catch(() => null);
        if (request !== this.request) return;
        this.html.set(html);
        this.showLine(this.line());
      }
    }
    if (request === this.request) this.loading.set(false);
  }

  private async highlight(text: string, path: string): Promise<SafeHtml> {
    const { codeToHtml } = await import('shiki');
    let html: string;
    try {
      html = await codeToHtml(text, { lang: languageFor(path), theme: 'github-light' });
    } catch {
      html = await codeToHtml(text, { lang: 'text', theme: 'github-light' });
    }
    // Shiki escapes the code; its markup is safe to insert.
    return this.sanitizer.bypassSecurityTrustHtml(html);
  }
}
