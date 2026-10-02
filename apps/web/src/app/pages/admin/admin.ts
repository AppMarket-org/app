import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-admin',
  imports: [MatCardModule],
  templateUrl: './admin.html',
  styleUrl: './admin.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Admin {
  constructor() {
    inject(Seo).set({ title: 'Admin', description: 'Moderation.', path: '/admin', noindex: true });
  }
}
