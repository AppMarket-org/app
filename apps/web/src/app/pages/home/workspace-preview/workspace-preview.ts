import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/** A clearly labelled illustration, never a substitute for live repository data. */
@Component({
  selector: 'app-workspace-preview',
  imports: [MatIconModule],
  templateUrl: './workspace-preview.html',
  styleUrl: './workspace-preview.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WorkspacePreview {}
