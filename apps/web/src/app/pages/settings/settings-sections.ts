import { inject } from '@angular/core';
import { type CanActivateFn, Router } from '@angular/router';

export const SETTINGS_SECTIONS = [
  { id: 'profile', label: 'Profile', icon: 'person', description: 'Your public name, picture, and bio.' },
  { id: 'privacy', label: 'Privacy', icon: 'shield', description: 'Choose what appears on your public profile.' },
  { id: 'notifications', label: 'Notifications', icon: 'notifications', description: 'Email preferences for your repositories and pull requests.' },
  { id: 'account', label: 'Account', icon: 'alternate_email', description: 'Manage your username and repository address.' },
  { id: 'organizations', label: 'Organizations', icon: 'corporate_fare', description: 'The teams you share repositories with.' },
  { id: 'access', label: 'Tokens & devices', icon: 'key', description: 'Manage signed-in browsers, agents, and CI tokens.' },
  { id: 'data', label: 'Data & exports', icon: 'download', description: 'Download your agent checkpoints.' },
] as const;

export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id'];

export const settingsSectionGuard: CanActivateFn = (route) =>
  SETTINGS_SECTIONS.some((s) => s.id === route.paramMap.get('section'))
    ? true
    : inject(Router).createUrlTree(['/settings/profile']);
