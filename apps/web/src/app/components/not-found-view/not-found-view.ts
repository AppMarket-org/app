import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-not-found-view',
  imports: [MatButtonModule, RouterLink],
  templateUrl: './not-found-view.html',
  styleUrl: './not-found-view.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundView {
  readonly title = input('This page wandered off.');
  readonly message = input('We couldn’t find the page you’re looking for.');
  readonly returnUrl = input('/');
  readonly returnLabel = input('Back to home');
}
