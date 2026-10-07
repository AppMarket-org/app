import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { effortLevelLabel, type Checkpoint } from '@appmarket/shared';
import { effortLine, toolGroups, toolIcon } from './timeline';

/** One checkpoint in full: effort, prompts, the agent's last message, tools and files (#116, #117). */
@Component({
  selector: 'app-checkpoint-details',
  imports: [DatePipe, MatExpansionModule, MatIconModule, MatListModule],
  templateUrl: './checkpoint-details.html',
  styleUrl: './checkpoint-details.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CheckpointDetails {
  readonly checkpoint = input.required<Checkpoint>();
  protected readonly effortLine = effortLine;
  protected readonly effortLabel = effortLevelLabel;
  /** The tools summed up per tool (the full, ordered list is folded away). */
  protected readonly groups = computed(() => toolGroups(this.checkpoint().tools ?? []));
  protected readonly icon = toolIcon;
}
