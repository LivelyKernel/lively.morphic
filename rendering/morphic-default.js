import vdom from "virtual-dom";
import { Transform } from "lively.graphics"

var {h, diff, patch, create} = vdom;

function shadowCss(morph) {
  var x = 1,
      y = 1,
      r = morph.rotation;
  r = (r + (2 * Math.PI)) % (2 * Math.PI);
  if (2*Math.PI > r && r > 1.5*Math.PI) {
    x = 1 - (((2*Math.PI - r)/(Math.PI/2)) * 2);
    y = 1;
  } else if (1.5*Math.PI > r && r > Math.PI) {
    x = -1;
    y = 1 - (((1.5*Math.PI - r)/(Math.PI/2)) * 2);
  } else if (Math.PI > r && r > (Math.PI/2)) {
    x = 1 + (((Math.PI/2 - r)/(Math.PI/2)) * 2);
    y = -1
  } else if (Math.PI/2 > r && r > 0) {
    y = 1 - ((r/(Math.PI/2)) * 2);
  }
  return `drop-shadow(${5 * x}px ${5 * y}px 5px rgba(0, 0, 0, 0.36))`
}

export function renderMorph(morph, renderer) {

  if (!morph.needsRerender()) {
    var rendered = renderer.renderMap.get(morph);
    if (rendered) return rendered;
  }

  morph.aboutToRender();

  var {
    visible,
    position: {x,y},
    extent: {x: width, y: height},
    origin,
    fill, borderWidth, borderColor, borderRadius: br,
    clipMode,
    reactsToPointer,
    owner
  } = morph;
  
  var style = {transform: new Transform()
                                  .preConcatenate(new Transform(morph.origin))
                                  .preConcatenate(morph.getTransform())
                                  .preConcatenate(new Transform(morph.origin).inverse())
                                  .preConcatenate(new Transform(owner && owner.origin))
                                  .toCSSTransformString(),
                transformOrigin: `${origin.x}px ${origin.y}px `,
                position: "absolute",
                display: visible ? "" : "none",
                width: width + 'px', height: height + 'px',
                overflow: clipMode,
                "pointer-events": reactsToPointer ? "auto" : "none",
                WebkitFilter: morph.dropShadow ? shadowCss(morph) : null};

  var tree = morph.shape(morph, style, morph.submorphs.map(m => m.render(renderer)));

  renderer.renderMap.set(morph, tree);
  return tree;

}

export function renderRootMorph(world, renderer) {
  if (!world.needsRerender()) return;

  var tree = renderer.renderMap.get(world) || world.render(renderer),
      domNode = renderer.domNode || (renderer.domNode = create(tree, renderer.domEnvironment)),
      newTree = world.render(renderer),
      patches = diff(tree, newTree);

  if (!domNode.parentNode) {
    renderer.rootNode.appendChild(domNode);
    renderer.ensureDefaultCSS();
  }

  patch(domNode, patches);
}
