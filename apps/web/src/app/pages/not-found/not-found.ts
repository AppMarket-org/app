import { NotFoundView } from '../../components/not-found-view/not-found-view';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-not-found',
  imports: [NotFoundView],
  templateUrl: './not-found.html',
  styleUrl: './not-found.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFound {
  constructor() {
    inject(Seo).set({ title: 'Page not found', description: 'This page does not exist.', path: '/404', noindex: true });
  }
}
