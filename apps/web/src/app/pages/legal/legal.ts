import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Seo } from '../../seo/seo';

@Component({
  selector: 'app-legal',
  imports: [],
  templateUrl: './legal.html',
  styleUrl: './legal.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Legal {
  protected readonly page = inject(ActivatedRoute).snapshot.paramMap.get('page') ?? '';

  constructor() {
    inject(Seo).set({ title: this.page, description: `appmarket.org ${this.page}`, path: `/legal/${this.page}` });
  }
}
