import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-dashboard',
  imports: [MatCardModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  constructor() {
    inject(Seo).set({ title: 'Developer dashboard', description: 'Manage your listings.', path: '/dashboard', noindex: true });
  }
}
