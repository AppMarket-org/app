import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, input, signal, type OnInit } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { type PullFiles, PullsApi, type PullSources } from '../../../api/pulls';
import { Seo } from '../../../seo/seo';

/** #259: open a pull request from a branch of this repo or of one of your forks. */
@Component({
  selector: 'app-new-pull',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule, ReactiveFormsModule, RouterLink],
  templateUrl: './new-pull.html',
  styleUrl: './new-pull.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewPullPage implements OnInit {
  private readonly api = inject(PullsApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly owner = input.required<string>();
  readonly slug = input.required<string>();

  protected readonly sources = signal<PullSources | null | undefined>(undefined);
  protected readonly preview = signal<PullFiles | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);

  protected readonly form = new FormGroup({
    source: new FormControl('', { nonNullable: true, validators: Validators.required }),
    sourceBranch: new FormControl('', { nonNullable: true, validators: Validators.required }),
    targetBranch: new FormControl('', { nonNullable: true, validators: Validators.required }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(200)] }),
    body: new FormControl('', { nonNullable: true, validators: Validators.maxLength(20000) }),
  });
  private readonly source = signal('');
  protected readonly branches = computed(() => this.sources()?.sources.find((s) => s.repo === this.source())?.branches ?? []);

  constructor() {
    inject(Seo).set({ title: 'New pull request', description: 'Propose changes.', path: '/', noindex: true });
  }

  protected get path(): string {
    return `${this.owner()}/${this.slug()}`;
  }

  async ngOnInit(): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.sources(this.path));
      this.sources.set(s);
      const wanted = this.route.snapshot.queryParamMap.get('source');
      const first = s.sources.find((x) => x.repo === wanted) ?? s.sources.find((x) => x.fork) ?? s.sources[0];
      this.form.controls.targetBranch.setValue(s.target.defaultBranch);
      if (first) this.pickSource(first.repo);
    } catch {
      this.sources.set(null);
    }
  }

  protected pickSource(repo: string): void {
    this.source.set(repo);
    this.form.controls.source.setValue(repo);
    const s = this.sources()?.sources.find((x) => x.repo === repo);
    // A fork proposes its default branch by default; this repo, its first other branch.
    const branch = s?.fork ? s.defaultBranch : (s?.branches.find((b) => b !== this.form.controls.targetBranch.value) ?? '');
    this.form.controls.sourceBranch.setValue(branch);
    void this.compare();
  }

  protected async compare(): Promise<void> {
    const { source, sourceBranch, targetBranch } = this.form.getRawValue();
    this.preview.set(null);
    this.previewError.set(null);
    if (!source || !sourceBranch || !targetBranch) return;
    if (source === this.path && sourceBranch === targetBranch) return void this.previewError.set('Pick a different branch to merge from.');
    try {
      const p = await firstValueFrom(this.api.compare(this.path, { source, branch: sourceBranch, target: targetBranch }));
      this.preview.set(p);
      if (!this.form.controls.title.value && p.commits.length === 1) this.form.controls.title.setValue(p.commits[0]!.message);
    } catch (e) {
      this.previewError.set(e instanceof HttpErrorResponse && typeof e.error?.message === 'string' ? e.error.message : 'These branches cannot be compared.');
    }
  }

  protected async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    const v = this.form.getRawValue();
    try {
      const pull = await firstValueFrom(this.api.open(this.path, { title: v.title, body: v.body, source: v.source, sourceBranch: v.sourceBranch, targetBranch: v.targetBranch }));
      await this.router.navigate(['/', this.owner(), this.slug(), 'pulls', pull.number]);
    } catch (e) {
      const body = e instanceof HttpErrorResponse ? (e.error as { message?: string; number?: number }) : null;
      if (body?.number) return void (await this.router.navigate(['/', this.owner(), this.slug(), 'pulls', body.number]));
      this.error.set(body?.message ?? 'Could not open the pull request.');
    } finally {
      this.busy.set(false);
    }
  }
}
