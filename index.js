/*global System*/
export { default as config } from "./config.js";
export * from "./morph.js";
export * from "./tooltips.js";
export * from "./world.js";
export * from "./text/morph.js";
export * from "./text/icons.js";
export * from "./text/label.js";
export * from "./text/range.js";
export * from "./html-morph.js";
export * from "./env.js";
export * from "./layout.js";
export * from "./partsbin.js";
export { StyleSheet } from "./style-sheets.js";
export { ShadowObject } from "./rendering/morphic-default.js";

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-


import { World, Hand } from "./world.js";
import { Morph, Image, Ellipse, Triangle, Path, Polygon, LineMorph } from "./morph.js";
import { Text } from "./text/morph.js";
import { Label } from "./text/label.js";
import { HTMLMorph } from './html-morph.js';

const classMapping = {
        world:    World,
        hand:     Hand,
        image:    Image,
        ellipse:  Ellipse,
        triangle: Triangle,
        path:     Path,
        text:     Text,
        label:    Label,
        polygon:  Polygon,
        line:     LineMorph,
        html:     HTMLMorph
}

export function registerMorphClass(name, klass) {
   classMapping[name] = klass;
}

export function morph(props = {}, opts = {restore: false}) {
  var klass = Morph;
  if (props.type) {
    if (typeof props.type === "function") klass = props.type;
    else if (typeof props.type === "string")
       klass = classMapping[props.type.toLowerCase()];
  }

  return opts.restore ?
    new klass({[Symbol.for("lively-instance-restorer")]: true}).initFromJSON(props) :
    new klass(props);
}
