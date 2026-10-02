import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-login',
  imports: [MatButtonModule, MatCardModule],
  templateUrl: './login.html',
  styleUrl: './login.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Login {
  constructor() {
    inject(Seo).set({ title: 'Sign in', description: 'Sign in to appmarket.org with Google or GitHub.', path: '/login', noindex: true });
  }
}
