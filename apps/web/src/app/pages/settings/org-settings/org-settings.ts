import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import type { OrgMember, OrgRole, Owner, OwnerProfile, OwnerProfileUpdate } from '@appmarket/shared';
import { firstValueFrom } from 'rxjs';
import { ProfileForm } from '../../../components/profile-form/profile-form';
import { AvatarEditor } from '../../../components/avatar-editor/avatar-editor';
import { Avatar } from '../../../components/avatar/avatar';
import { profileErrors } from '../../../components/profile-form/profile-errors';
import { OwnersApi } from '../../../api/owners';
import { Auth } from '../../../auth/auth';
import { Seo } from '../../../seo/seo';

const ERRORS: Record<string, string> = {
  no_such_user: 'There is no user with that username.',
  last_owner: 'An organization needs at least one owner.',
};

/** #102: an organization's members. Owners add, remove and promote; members can leave. */
@Component({
  selector: 'app-org-settings',
  imports: [MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule, MatListModule, MatProgressBarModule, MatSelectModule, Avatar, AvatarEditor, MatSlideToggleModule, MatSnackBarModule, ProfileForm, ReactiveFormsModule, RouterLink],
  templateUrl: './org-settings.html',
  styleUrl: './org-settings.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OrgSettings {
  /** From the route /settings/orgs/:handle. */
  readonly handle = input.required<string>();

  private readonly api = inject(OwnersApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly seo = inject(Seo);

  protected readonly org = signal<Owner | null>(null);
  protected readonly role = signal<OrgRole | null>(null);
  protected readonly members = signal<OrgMember[]>([]);
  protected readonly notFound = signal(false);
  protected readonly publicMembership = signal(false);
  protected readonly profile = signal<OwnerProfile | null>(null);
  protected readonly profileSaving = signal(false);
  protected readonly profileFieldErrors = signal<Record<string, string>>({});
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly add = inject(FormBuilder).nonNullable.group({
    handle: ['', Validators.required],
    role: ['member' as OrgRole],
  });

  async ngOnInit(): Promise<void> {
    this.seo.set({ title: 'Organization', description: 'Organization members.', path: `/settings/orgs/${this.handle()}`, noindex: true });
    try {
      const res = await firstValueFrom(this.api.members(this.handle()));
      const { org, role, members } = res;
      this.org.set(org);
      this.role.set(role);
      this.publicMembership.set(res.public);
      this.members.set(members);
      // #139: only owners edit the organization's profile.
      if (role === 'owner') this.profile.set((await firstValueFrom(this.api.profile(org.handle))).profile);
      this.seo.setHeading([{ label: org.handle, link: `/${org.handle}` }, { label: 'Members' }]);
    } catch {
      this.notFound.set(true);
    }
  }

  protected async setPublic(visible: boolean): Promise<void> {
    try {
      await firstValueFrom(this.api.setMembershipPublic(this.handle(), visible));
      this.publicMembership.set(visible);
      this.snackBar.open(visible ? 'Shown on profiles' : 'Hidden from profiles', undefined, { duration: 2500 });
    } catch {
      this.snackBar.open('Could not change that. Try again.', 'OK', { duration: 4000 });
    }
  }

  protected async saveProfile(update: OwnerProfileUpdate): Promise<void> {
    this.profileSaving.set(true);
    this.profileFieldErrors.set({});
    try {
      const { owner, profile } = await firstValueFrom(this.api.updateProfile(update, this.handle()));
      this.org.set(owner);
      this.profile.set(profile);
      this.snackBar.open('Profile saved', undefined, { duration: 2500 });
    } catch (error) {
      this.profileFieldErrors.set(profileErrors(error));
      this.snackBar.open('Check the highlighted fields.', 'OK', { duration: 4000 });
    } finally {
      this.profileSaving.set(false);
    }
  }

  protected isMe(member: OrgMember): boolean {
    return member.userId === this.auth.user()?.id;
  }

  protected async addMember(): Promise<void> {
    if (this.add.invalid || this.busy()) return;
    const { handle, role } = this.add.getRawValue();
    await this.change(() => this.api.setMember(this.handle(), { handle: handle.trim().toLowerCase(), role }), `${handle} added`);
    this.add.reset({ handle: '', role: 'member' });
  }

  protected setRole(member: OrgMember, role: OrgRole): Promise<void> {
    return this.change(() => this.api.setMember(this.handle(), { handle: member.handle, role }), `${member.handle} is now ${role === 'owner' ? 'an owner' : 'a member'}`);
  }

  protected async remove(member: OrgMember): Promise<void> {
    const leaving = this.isMe(member);
    await this.change(() => this.api.removeMember(this.handle(), member.handle), leaving ? 'You left the organization' : `${member.handle} removed`);
    if (leaving && !this.error()) {
      this.auth.refreshOwner();
      await this.router.navigateByUrl('/settings');
    }
  }

  private async change(call: () => ReturnType<OwnersApi['setMember']>, done: string): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      this.members.set((await firstValueFrom(call())).members);
      this.snackBar.open(done, undefined, { duration: 3000 });
    } catch (e) {
      const code = e instanceof HttpErrorResponse ? (e.error?.error as string | undefined) : undefined;
      this.error.set(ERRORS[code ?? ''] ?? 'That change could not be made.');
    } finally {
      this.busy.set(false);
    }
  }
}
