import { Component, signal } from "@angular/core";
import { TutorialCodeCellComponent } from "./tutorial-code-cell";
import {
  TUTORIAL_CHAPTERS,
  TUTORIAL_MENU,
  toggleTutorialMenuGroup,
  type TutorialMenuGroupTitle,
} from "./tutorial-content";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [TutorialCodeCellComponent],
  templateUrl: "./app.html",
})
export class App {
  readonly tutorialChapters = TUTORIAL_CHAPTERS;
  readonly tutorialMenu = TUTORIAL_MENU;
  readonly openMenuGroup = signal<TutorialMenuGroupTitle | null>(null);

  toggleMenuGroup(title: TutorialMenuGroupTitle): void {
    this.openMenuGroup.update((current) => toggleTutorialMenuGroup(current, title));
  }
}
