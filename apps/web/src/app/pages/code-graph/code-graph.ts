import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatAutocompleteModule, type MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { CodeGraphApi, type CodeGraphMap, type GraphSymbol } from '../../api/code-graph';
import { Auth } from '../../auth/auth';
import { CodeGraphPanel, SYMBOL_ICONS } from '../../components/code-graph-panel/code-graph-panel';
import { RepositoryHeader } from '../../components/repository-header/repository-header';
import { RepositoryNav } from '../../components/repository-nav/repository-nav';
import { Seo } from '../../seo/seo';
import { buildGraph, fit, folderOf, layout, radius, type MapEdge, type MapNode } from './layout';

/** Folder colours: appmarket.org's palette (primary, tertiary, secondary, copper, and their tints). */
const COLORS = ['#923f20', '#35664d', '#526054', '#c6754b', '#6b4f8a', '#2f6f8f', '#a8763e', '#7a5c4f', '#4f7d6a', '#8a3b5c'];
const WIDTH = 1200;
const HEIGHT = 800;

/**
 * #240 for people: the code graph of the default branch as a map. Files (or folders, in a large
 * repo) are dots coloured by top-level folder, sized by what they define; lines are imports.
 * Selecting a file shows what it imports and what imports it, or what a change to it can affect.
 */
@Component({
  selector: 'app-code-graph',
  imports: [CodeGraphPanel, FormsModule, MatAutocompleteModule, MatButtonModule, MatChipsModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSlideToggleModule, MatTooltipModule, RepositoryHeader, RepositoryNav, RouterLink],
  templateUrl: './code-graph.html',
  styleUrl: './code-graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CodeGraphPage {
  private readonly api = inject(CodeGraphApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();
  protected readonly path = computed(() => `${this.owner()}/${this.slug()}`);
  protected readonly managed = computed(() => this.auth.owner()?.handle === this.owner() || this.auth.orgs().some((m) => m.org.handle === this.owner()));
  private readonly query = toSignal(this.route.queryParamMap, { requireSync: true });
  /** The selected file (in the URL, so it can be linked and the code view can open the map on it). */
  protected readonly selected = computed(() => this.query().get('file'));
  /** In a large repo, the folder opened to its files. */
  protected readonly openFolder = signal<string | null>(null);
  protected readonly impactMode = signal(false);

  /** undefined while loading; null when there is no graph (no commits, or not allowed). */
  protected readonly map = signal<CodeGraphMap | null | undefined>(undefined);
  protected readonly error = signal<string | null>(null);
  protected readonly graph = computed(() => {
    const m = this.map();
    if (!m) return null;
    const g = buildGraph(m.files, m.edges, this.openFolder());
    if (this.browser) layout(g.nodes, g.edges, { width: WIDTH, height: HEIGHT });
    return g;
  });
  /** The biggest nodes, which keep their labels at every zoom. */
  private readonly prominent = computed(() => new Set([...(this.graph()?.nodes ?? [])].sort((a, b) => b.files * 4 + b.symbols - (a.files * 4 + a.symbols)).slice(0, 14).map((n) => n.id)));
  protected readonly byId = computed(() => new Map((this.graph()?.nodes ?? []).map((n) => [n.id, n])));
  protected readonly groups = computed(() => [...new Set((this.graph()?.nodes ?? []).map((n) => n.group))].sort());
  protected readonly color = (group: string) => COLORS[this.groups().indexOf(group) % COLORS.length]!;
  protected readonly radius = radius;
  /** The node that stands for the selected file (itself, or its folder). */
  protected readonly focus = computed(() => {
    const file = this.selected();
    if (!file) return null;
    const ids = this.byId();
    return ids.has(file) ? file : ids.has(folderOf(file)) ? folderOf(file) : null;
  });
  /** What to emphasise around the focus: its direct imports and importers, or what a change to it can affect (by depth). */
  protected readonly highlight = computed(() => {
    const focus = this.focus();
    const g = this.graph();
    const out = new Map<string, 'focus' | 'imports' | 'importedBy' | number>();
    if (!focus || !g) return out;
    out.set(focus, 'focus');
    if (this.impactMode()) {
      let frontier = [focus];
      for (let depth = 1; depth <= 3 && frontier.length; depth++) {
        const next: string[] = [];
        for (const e of g.edges) if (frontier.includes(e.target) && !out.has(e.source)) (out.set(e.source, depth), next.push(e.source));
        frontier = next;
      }
    } else {
      for (const e of g.edges) {
        if (e.source === focus && !out.has(e.target)) out.set(e.target, 'imports');
        if (e.target === focus && !out.has(e.source)) out.set(e.source, 'importedBy');
      }
    }
    return out;
  });
  protected readonly impactCount = computed(() => [...this.highlight().values()].filter((v) => typeof v === 'number').length);

  // Pan and zoom, as an SVG viewBox.
  protected readonly view = signal({ x: 0, y: 0, w: WIDTH, h: HEIGHT });
  protected readonly viewBox = computed(() => {
    const v = this.view();
    return `${v.x} ${v.y} ${v.w} ${v.h}`;
  });
  /** Screen units per map unit: labels keep their size at any zoom. */
  protected readonly scale = computed(() => this.view().w / WIDTH);
  protected readonly hovered = signal<string | null>(null);
  private drag: { x: number; y: number; vx: number; vy: number; moved: boolean } | null = null;

  // Symbol search.
  protected readonly q = signal('');
  protected readonly hits = signal<GraphSymbol[]>([]);
  protected readonly symbolIcons = SYMBOL_ICONS;

  constructor() {
    const seo = inject(Seo);
    seo.set({ title: 'Code graph', description: 'The repo’s files, what they define and how they import each other.', path: '/', noindex: true });
    effect(() => seo.setHeading([{ label: this.owner(), link: '/' + this.owner() }, { label: this.slug(), link: `/${this.path()}/code` }, { label: 'Graph' }]));
    effect(() => {
      const path = this.path();
      untracked(() => void this.load(path));
    });
    // Fit the view to the map, or to the folder just opened.
    effect(() => {
      const g = this.graph();
      const folder = this.openFolder();
      if (!g || !this.browser) return;
      const inFolder = folder ? g.nodes.filter((n) => n.kind === 'file' && folderOf(n.id) === folder) : [];
      untracked(() => this.view.set(fit(inFolder.length ? inFolder : g.nodes, { width: WIDTH, height: HEIGHT })));
    });
    // A selected file inside a folder of a large repo opens that folder.
    effect(() => {
      const file = this.selected();
      const g = untracked(() => this.graph());
      if (file && g?.grouped && !g.nodes.some((n) => n.id === file)) untracked(() => this.openFolder.set(folderOf(file)));
    });
  }

  protected retry(): void {
    void this.load(this.path());
  }

  private async load(path: string): Promise<void> {
    this.map.set(undefined);
    this.error.set(null);
    try {
      this.map.set(await firstValueFrom(this.api.map(path)));
    } catch (e) {
      const status = (e as { status?: number }).status;
      this.error.set(status === 409 ? 'This repo has no commits yet.' : 'Could not load the code graph.');
      this.map.set(null);
    }
  }

  protected select(node: MapNode): void {
    if (node.kind === 'folder') {
      this.openFolder.set(node.id);
      return;
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams: { file: node.id }, queryParamsHandling: 'merge' });
  }

  protected selectFile(file: string): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { file }, queryParamsHandling: 'merge' });
  }

  protected clear(): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: { file: null }, queryParamsHandling: 'merge' });
  }

  protected openLine(line: number): void {
    void this.router.navigate(['/', this.owner(), this.slug(), 'code'], { queryParams: { file: this.selected(), line } });
  }

  protected async search(q: string | GraphSymbol): Promise<void> {
    // Choosing a suggestion writes the symbol itself into the box; chooseSymbol handles that.
    if (typeof q !== 'string') return;
    this.q.set(q);
    const term = q.trim();
    if (!/^[A-Za-z_$][\w$]{0,99}$/.test(term)) return this.hits.set([]);
    const r = await firstValueFrom(this.api.symbols(this.path(), term)).catch(() => null);
    if (this.q() === q) this.hits.set(r?.symbols.slice(0, 20) ?? []);
  }

  protected chooseSymbol(event: MatAutocompleteSelectedEvent): void {
    const s = event.option.value as GraphSymbol;
    this.q.set('');
    this.hits.set([]);
    this.selectFile(s.path);
  }

  protected readonly symbolLabel = (s: GraphSymbol | string | null) => (typeof s === 'string' ? s : '');

  protected edgeClass(e: MapEdge): string {
    const h = this.highlight();
    if (!h.size) return '';
    const s = h.get(e.source);
    const t = h.get(e.target);
    if (this.impactMode()) return s !== undefined && t !== undefined && (typeof s === 'number' || s === 'focus') ? 'on impact' : 'off';
    return s === 'focus' || t === 'focus' ? (s === 'focus' ? 'on imports' : 'on importedBy') : 'off';
  }

  protected readonly strokeWidth = (e: MapEdge) => Math.min(1 + e.weight * 0.3, 4);

  protected nodeClass(n: MapNode): string {
    const h = this.highlight().get(n.id);
    if (!this.highlight().size) return '';
    if (h === undefined) return 'dim';
    return typeof h === 'number' ? `impact d${h}` : h;
  }

  protected showLabel(n: MapNode): boolean {
    return this.hovered() === n.id || this.highlight().has(n.id) || (!this.highlight().size && this.prominent().has(n.id));
  }

  protected node(id: string | MapNode): MapNode {
    return typeof id === 'string' ? this.byId().get(id)! : id;
  }

  // Wheel zooms around the pointer; dragging the background pans.
  protected wheel(event: WheelEvent, svg: Element): void {
    event.preventDefault();
    const rect = svg.getBoundingClientRect();
    const v = this.view();
    const px = v.x + ((event.clientX - rect.left) / rect.width) * v.w;
    const py = v.y + ((event.clientY - rect.top) / rect.height) * v.h;
    const k = Math.min(Math.max(event.deltaY > 0 ? 1.15 : 1 / 1.15, WIDTH / 8 / v.w), (WIDTH * 3) / v.w);
    this.view.set({ x: px - (px - v.x) * k, y: py - (py - v.y) * k, w: v.w * k, h: v.h * k });
  }

  protected down(event: PointerEvent): void {
    const v = this.view();
    this.drag = { x: event.clientX, y: event.clientY, vx: v.x, vy: v.y, moved: false };
  }

  protected move(event: PointerEvent, svg: Element): void {
    if (!this.drag) return;
    const rect = svg.getBoundingClientRect();
    const v = this.view();
    const dx = ((event.clientX - this.drag.x) / rect.width) * v.w;
    const dy = ((event.clientY - this.drag.y) / rect.height) * v.h;
    if (Math.abs(dx) + Math.abs(dy) > 2) this.drag.moved = true;
    this.view.set({ ...v, x: this.drag.vx - dx, y: this.drag.vy - dy });
  }

  protected up(): void {
    this.drag = null;
  }

  protected zoom(factor: number): void {
    const v = this.view();
    const cx = v.x + v.w / 2;
    const cy = v.y + v.h / 2;
    this.view.set({ x: cx - (v.w * factor) / 2, y: cy - (v.h * factor) / 2, w: v.w * factor, h: v.h * factor });
  }

  protected reset(): void {
    this.view.set(fit(this.graph()?.nodes ?? [], { width: WIDTH, height: HEIGHT }));
  }

  protected backToFolders(): void {
    this.openFolder.set(null);
    this.clear();
  }
}
