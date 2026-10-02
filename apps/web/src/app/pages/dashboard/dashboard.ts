import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-dashboard',
  imports: [MatButtonModule, MatCardModule, RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  constructor() {
    inject(Seo).set({ title: 'Developer dashboard', description: 'Manage your listings.', path: '/dashboard', noindex: true });
  }
}
