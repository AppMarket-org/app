import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

interface Graph {
  ancestors: { fullName: string; name: string }[];
  children: { fullName: string; name: string }[];
  otherForks: number;
  descendants: number;
  dependencies: { name: string; range: string | null; dev: boolean }[];
  bindings: { type: string; name: string | null }[];
}

/** #67 (G1): where an app comes from, what was built from it, and what it depends on. */
@Component({
  selector: 'app-repo-graph',
  imports: [MatButtonModule, MatChipsModule, MatExpansionModule, RouterLink],
  templateUrl: './repo-graph.html',
  styleUrl: './repo-graph.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RepoGraph {
  readonly path = input.required<string>();
  private readonly http = inject(HttpClient);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  protected readonly graph = signal<Graph | null>(null);
  protected readonly runtimeDeps = computed(() => this.graph()?.dependencies.filter((d) => !d.dev) ?? []);
  protected readonly devDeps = computed(() => this.graph()?.dependencies.filter((d) => d.dev) ?? []);

  async ngOnInit(): Promise<void> {
    if (!this.isBrowser) return;
    this.graph.set(await firstValueFrom(this.http.get<Graph>(`/api/repos/${this.path()}/graph`)).catch(() => null));
  }
}
