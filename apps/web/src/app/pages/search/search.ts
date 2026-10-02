import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-search',
  imports: [MatFormFieldModule, MatInputModule, MatIconModule],
  templateUrl: './search.html',
  styleUrl: './search.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Search {
  constructor() {
    inject(Seo).set({ title: 'Search apps', description: 'Search apps on appmarket.org.', path: '/search' });
  }
}
