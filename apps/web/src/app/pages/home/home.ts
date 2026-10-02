import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { RouterLink } from '@angular/router';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-home',
  imports: [MatButtonModule, MatCardModule, RouterLink],
  templateUrl: './home.html',
  styleUrl: './home.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Home {
  constructor() {
    inject(Seo).set({ title: 'App marketplace', description: 'Discover, try and deploy apps into your own Cloudflare account.', path: '/' });
  }
}
