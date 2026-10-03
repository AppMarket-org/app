import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import type { Repo, RepoInput } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { RepoForm } from '../../components/repo-form/repo-form';
import { Auth } from '../../auth/auth';
import { Seo } from '../../seo/seo';
import { describeRepoError } from '../repo-errors';

/** PRD R15: create a draft repo. Its Artifacts repo is created with it (R2). */
@Component({
  selector: 'app-new-repo',
  imports: [FormsModule, MatCardModule, MatFormFieldModule, MatProgressBarModule, MatSelectModule, MatSnackBarModule, RepoForm],
  templateUrl: './new-repo.html',
  styleUrl: './new-repo.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NewRepo {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly auth = inject(Auth);
  /** #102: create it under yourself (empty) or an organization you belong to. */
  protected readonly owner = signal('');
  protected readonly ownerHandle = computed(() => this.owner() || this.auth.owner()?.handle || 'you');
  protected readonly saving = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  constructor() {
    inject(Seo).set({ title: 'New repo', description: 'Create a repo for your app on appmarket.org.', path: '/dashboard/new', noindex: true });
  }

  protected async create(input: RepoInput): Promise<void> {
    this.saving.set(true);
    this.errorMessage.set(null);
    try {
      const repo = await firstValueFrom(this.http.post<Repo>('/api/repos', { ...input, owner: this.owner() || undefined }));
      this.snackBar.open('Draft created. Push your code, then submit a version for review.', 'OK', { duration: 6000 });
      await this.router.navigateByUrl(`/dashboard/repos/${repo.fullName}`);
    } catch (error) {
      const { message, fieldErrors } = describeRepoError(error);
      this.errorMessage.set(message);
      this.fieldErrors.set(fieldErrors);
    } finally {
      this.saving.set(false);
    }
  }
}
