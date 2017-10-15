/*global System*/
export { default as config } from "./config.js";
export * from "./morph.js";
export * from "./world.js";
export * from "./text/morph.js";
export * from "./text/label.js";
export * from "./html-morph.js";
export * from "./env.js";
export * from "./layout.js";
export { StyleSheet } from "./style-sheets.js";
export { show } from "lively.halos/markers.js"
export { ShadowObject } from "./rendering/morphic-default.js";
export { Button } from "lively.components/buttons.js";
export { Menu } from "lively.components/menus.js";
export * from "./tooltips.js";
export { Icon } from "./text/icons.js";
export * from "lively.components/list.js";

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

import { World, Hand } from "./world.js";
import { Morph, Image, Ellipse, Triangle, Path, Polygon, LineMorph } from "./morph.js";
import { Text } from "./text/morph.js";
import { Label } from "./text/label.js";
import { Button } from "lively.components/buttons.js";
import { CheckBox, LabeledCheckBox } from "lively.components/widgets.js";
import { List, DropDownList } from "lively.components/list.js";
import { HTMLMorph } from './html-morph.js';
import Window from "lively.components/window.js";
import InputLine from "./text/input-line.js";
export { Window, InputLine };

export function morph(props = {}, opts = {restore: false}) {
  var klass = Morph;
  if (props.type) {
    if (typeof props.type === "function") klass = props.type;
    else if (typeof props.type === "string")
      switch (props.type.toLowerCase()) {
        case 'world':           klass = World; break;
        case 'hand':            klass = Hand; break;
        case 'image':           klass = Image; break;
        case 'ellipse':         klass = Ellipse; break;
        case 'triangle':        klass = Triangle; break;
        case 'path':            klass = Path; break;
        case 'text':            klass = Text; break;
        case 'input':           klass = InputLine; break;
        case 'label':           klass = Label; break;
        case 'list':            klass = List; break;
        case 'dropdownlist':    klass = DropDownList; break;
        case 'button':          klass = Button; break;
        case 'checkbox':        klass = CheckBox; break;
        case 'labeledcheckbox': klass = LabeledCheckBox; break;
        case 'polygon':         klass = Polygon; break;
        case 'line':            klass = LineMorph; break;
        case 'html':            klass = HTMLMorph; break;
      }
  }

  return opts.restore ?
    new klass({[Symbol.for("lively-instance-restorer")]: true}).initFromJSON(props) :
    new klass(props);
}

async function lazyInspect(obj) {
  // lazy load
  var {inspect: realInspect} = await System.import("lively.ide/js/inspector.js")
  inspect = realInspect;
  return realInspect(obj);
}

export var inspect = lazyInspect;
