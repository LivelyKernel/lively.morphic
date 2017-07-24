import { Color } from "lively.graphics";
import { Morph, StyleSheet, Label, HorizontalLayout, config } from "lively.morphic";

export class TooltipViewer {

  constructor(world) {
    this.currenMorph = world;
  }

  notPartOfCurrentTooltip(newTarget) {
    return !newTarget.ownerChain().includes(this.currentMorph);
  }

  invalidatesCurrentTooltip(newTarget) {
    return newTarget.tooltip || this.notPartOfCurrentTooltip(newTarget);
  }

  mouseMove({targetMorph, hand}) {
    if (this.currentMorph === targetMorph
     || !this.invalidatesCurrentTooltip(targetMorph)) return;
    this.hoverOutOfMorph(this.currentMorph);
    this.hoverIntoMorph(targetMorph, hand);
    this.currentMorph = targetMorph;
  }

  mouseDown({targetMorph}) {
    this.currentTooltip && this.currentTooltip.remove();
    this.currentTooltip = null;
  }

  hoverIntoMorph(morph, hand) {
    this.clearScheduledTooltip();
    if (this.currentTooltip) {
      this.showTooltipFor(morph, hand);
    } else {
      this.scheduleTooltipFor(morph, hand);
    }
  }

  hoverOutOfMorph(morph) {
    const current = this.currentTooltip;
    this.currentTooltip && this.currentTooltip.softRemove((tooltip) =>
      this.currentTooltip == tooltip && (this.currentTooltip = null));
  }

  scheduleTooltipFor(morph, hand) {
    this.timer = setTimeout(
      () => this.showTooltipFor(morph, hand),
      config.showTooltipsAfter * 1000);
  }

  clearScheduledTooltip() {
    clearTimeout(this.timer);
  }

  showTooltipFor(morph, hand) {
    if (!morph.tooltip || !morph.world()) return;
    this.currentTooltip && this.currentTooltip.remove();
    var position = hand ? hand.position.addXY(10,7) : morph.globalBounds().bottomRight();
    this.currentTooltip = new Tooltip({position, description: morph.tooltip});
    morph.world().addMorph(this.currentTooltip);
  }

}

export class Tooltip extends Morph {

  static get styleSheet() {
    return new StyleSheet({
      ".Tooltip": {
        draggable: false,
        fill: Color.black.withA(0.5),
        borderRadius: 4,
        fontColor: Color.white,
        layout: new HorizontalLayout({spacing: 5})
      },
      '.Tooltip .Label': {
        fontColor: Color.white
      }
    })
  }

  static get properties() {
    return {
      description: {
        after: ['submorphs'],
        derived: true,
        get() {
          const [descriptor] = this.submorphs;
          return descriptor.value;
        },
        set(stringOrAttributes) {
          const [descriptor] = this.submorphs;
          descriptor.fixedWidth = stringOrAttributes.length > 40;
          descriptor.value = stringOrAttributes;
        }
      },
      submorphs: {
        initialize() {
          this.submorphs = [
            new Label({
              width: 200,
            })
          ];
        }
      }
    }
  }

  async softRemove(cb) {
    await this.animate({opacity: 0});
    cb && cb(this);
    this.remove();
  }

}
