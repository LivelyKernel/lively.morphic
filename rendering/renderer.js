import { promise, num } from "lively.lang";
import { addOrChangeCSSDeclaration, addOrChangeLinkedCSS } from "./dom-helper.js";
import { defaultStyle, defaultAttributes, render, 
         pathAttributes, polygonAttributes, svgAttributes } from "./morphic-default.js";
import { h } from "virtual-dom";
import { pt } from "lively.graphics";

const defaultCSS = `

/*-=- html fixes -=-*/

.no-html-select {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
}

.hiddenScrollbar::-webkit-scrollbar { 
  /* This is the magic bit */
  display: none;
}


/*-=- generic morphic -=-*/

.Morph {
  outline: none;
  /*for aliasing issue in chrome: http://stackoverflow.com/questions/6492027/css-transform-jagged-edges-in-chrome*/
  -webkit-backface-visibility: hidden;

  /*include border size in extent of element*/
  box-sizing: border-box;

  /*don't use dom selection on morphs*/
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  zIndex: 1010
}

.Tooltip {
  z-index:  3;
}

.Hand {
  z-index: 1;
}

/*-=- halos -=-*/

.Halo {
  z-index: 2;
}

.HaloItem {
  /*FIXME: we shouldn't need to hardcode the size...*/
	 line-height: 24px !important;
	 text-align: center;
	 vertical-align: middle;
}

/*-=- text -=-*/

.center-text {
	 text-align: center;
	 vertical-align: middle;
}

div.text-layer span {
  pointer-events: none;
  line-height: normal;
}

/*-=- text -=-*/

.Label .annotation {
  float: right;
  /*vertical align*/
  position: relative;
  top: 50%;
  transform: translateY(-50%);
}
`;

export class Renderer {

  static default() { return this._default || new this() }

  constructor(world, rootNode, domEnvironment) {
    if (!world || !world.isMorph)
      throw new Error(`Trying to initialize renderer with an invalid world morph: ${world}`)
    if (!rootNode || !("nodeType" in rootNode))
      throw new Error(`Trying to initialize renderer with an invalid root node: ${rootNode}`)
    if (!domEnvironment) {
      var doc = rootNode.ownerDocument;
      domEnvironment = {window: System.global, document: doc};
    }
    this.worldMorph = world;
    world._renderer = this;
    this.rootNode = rootNode;
    this.domNode = null;
    this.domEnvironment = domEnvironment;
    this.renderMap = new WeakMap();
    this.renderWorldLoopProcess = null;
    this.afterRenderCallTargets = [];
    this.requestAnimationFrame = domEnvironment.window.requestAnimationFrame.bind(domEnvironment.window);
  }

  clear() {
    this.stopRenderWorldLoop();
    this.domNode && this.domNode.parentNode.removeChild(this.domNode);
    this.domNode = null;
    this.renderMap = new WeakMap();
  }

  ensureDefaultCSS() {
    return promise.waitFor(3000, () => this.domNode.ownerDocument)
      .then(doc => Promise.all([
        addOrChangeCSSDeclaration("lively-morphic-css", defaultCSS, doc),
        addOrChangeLinkedCSS("lively-font-awesome", System.decanonicalize("lively.morphic/assets/font-awesome/css/font-awesome.css"), doc),
        addOrChangeLinkedCSS("lively-font-inconsolata", System.decanonicalize("lively.morphic/assets/inconsolata/inconsolata.css"), doc)]));
  }

  startRenderWorldLoop() {
    this.renderWorldLoopProcess = this.requestAnimationFrame(() => this.startRenderWorldLoop());
    this.worldMorph.renderAsRoot(this);
    return this;
  }

  stopRenderWorldLoop() {
    this.domEnvironment.window.cancelAnimationFrame(this.renderWorldLoopProcess);
    this.renderWorldLoopProcess = null;
  }

  getNodeForMorph(morph) {
    // Hmm, this also finds dom nodes not associated with this renderer, its
    // domNode... Is this a problem?
    // return this.domNode.ownerDocument.getElementById(morph.id);

    // test, for scoped lookup, fixing the issue mentioned above
    return this.domNode ? this.domNode.querySelector("#" + morph.id) : null;
  }

  getMorphForNode(node) {
    return this.worldMorph ?
      this.worldMorph.withAllSubmorphsDetect(morph => morph.id === node.id) :
      null;
  }

  render(x) {
    if (!x.needsRerender()) {
      var renderedTree = this.renderMap.get(x);
      if (renderedTree) return renderedTree;
    }

    x.aboutToRender(this);

    var tree = x.render(this);
    this.renderMap.set(x, tree);
    return tree;
  }

  renderMorph(morph) {
    return h("div", {
      ...defaultAttributes(morph, this),
      style: defaultStyle(morph)
    }, this.renderSubmorphs(morph));
  }

  renderSubmorphs(morph) {
    return h("div", {
          style: {
            position: "absolute",
            transform: `translate(${morph.origin.x - morph.borderWidthLeft}px,${morph.origin.y - morph.borderWidthTop}px)`
          }
        }, morph.submorphs.map(m => this.render(m)));
  }


  renderImage(image) {
    return h("div", {
      ...defaultAttributes(image, this),
        style: defaultStyle(image)
      }, [
        h("img", {
          src: image.imageUrl,
          draggable: false,
          style: {
            "pointer-events": "none",
            position: "absolute",
            width: "100%", height: "100%"
          }
        }),
        this.renderSubmorphs(image)
      ]);
  }
  
  renderCheckBox(checkbox) {
    return h("div", {
      ...defaultAttributes(checkbox, this),
        style: defaultStyle(checkbox)
      }, [
        h("input", {
          type: "checkbox",
          checked: checkbox.checked,
          disabled: !checkbox.active,
          draggable: false,
          style: {
            "pointer-events": "none",
            position: "relative",
            top: "-3px",
            left: "-4px",
            width: "100%", height: "100%"
          }
        }),
        this.renderSubmorphs(checkbox)
      ]);
  }

  // FIXME: The gradient handling is inconsistent to the way its handled in "vanilla" morphs

  renderPath(path) {
    const vertices = h("path",
                    {namespace: "http://www.w3.org/2000/svg",
                     id : "svg" + path.id,
                     ...pathAttributes(path)});
    return this.renderSvgMorph(path, vertices);
  }

  renderPolygon(polygon) {
    const vertices = h("polygon",
                        {namespace: "http://www.w3.org/2000/svg",
                         id: "svg" + polygon.id,
                         ...polygonAttributes(polygon)});
    return this.renderSvgMorph(polygon, vertices);
  }

  renderSvgMorph(morph, svg) {
    const {position, filter,
           display, top, left, opacity, 
           transform, transformOrigin, cursor} = defaultStyle(morph),
          {width, height} = morph.innerBounds(),
          defs = morph.gradient && renderGradient(morph);
    return h("div", {...defaultAttributes(morph, this),
                     style: {transform, transformOrigin, position, opacity, cursor,
                             width: width + 'px', height: height + 'px',
                             display, filter, "pointer-events": "auto"}},
              [h("svg", {namespace: "http://www.w3.org/2000/svg", version: "1.1",
                        style: {position: "absolute", "pointer-events": "none"},
                        ...svgAttributes(morph)},
                  [defs, svg]),
                this.renderSubmorphs(morph)]);
  }
}


function renderGradient(morph) {
  return h("defs", {namespace: "http://www.w3.org/2000/svg"},
                h("linearGradient", {namespace: "http://www.w3.org/2000/svg",
                                     attributes: {id: "gradient-" + morph.id,
                                                  gradientUnits: "userSpaceOnUse"}
                                     },
                    morph.gradient.map(([k, c]) =>
                        h("stop",
                            {namespace: "http://www.w3.org/2000/svg",
                              attributes:
                                {offset: (k * 100) + "%",
                                 "stop-color": c}}))));
}
