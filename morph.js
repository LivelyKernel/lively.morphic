import { Color, pt, rect } from "lively.graphics";

const defaultProperties = {
  position:  pt(0,0),
  rotation:  0,
  scale:  1,
  extent:  pt(10, 10),
  fill:  Color.white,
  clipMode:  "visible",
  _submorphs: []
}

export class Morph {

  constructor(props) {
    this._owner = null;
    this._dirty = true; // for initial display
    Object.assign(this, defaultProperties, props);
    this._submorphs = this._submorphs.slice();
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // changes
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  change(change) {
    this.makeDirty();
    return change;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // render hooks
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  makeDirty() {
    this._dirty = true;
    if (this.owner) this.owner.makeDirty();
  }

  needsRerender() {
    return !!this._dirty;
  }
  
  aboutToRender() {
    this._dirty = false;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // morphic interface
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  get position()       { return this._position; }
  set position(value)  { this._position = value; this.makeDirty(); }

  get scale()          { return this._scale; }
  set scale(value)     { this._scale = value; this.makeDirty(); }

  get rotation()       { return this._rotation; }
  set rotation(value)  { this._rotation = value; this.makeDirty(); }

  get extent()         { return this._extent; }
  set extent(value)    { this._extent = value; this.makeDirty(); }

  get fill()           { return this._fill; }
  set fill(value)      { this._fill = value; this.makeDirty(); }

  get clipMode()       { return this._clipMode; }
  set clipMode(value)  { this._clipMode = value; this.makeDirty(); }

  get submorphs()      { return this._submorphs; }
  addMorph(morph) {
    morph._owner = this;
    this._submorphs.push(morph)
    this.makeDirty();
    return morph;
  }
  remove() {
    var o = this.owner;
    if (o) {
      this._owner = null;
      var index = o._submorphs.indexOf(this);
      if (index > -1) o._submorphs.splice(index, 1);
      o.makeDirty();
    }
  }
  get owner() { return this._owner; }

  bounds() {
    var {x,y} = this.position, {x:w,y:h} = this.extent;
    return rect(x,y,w,h);
  }

  innerBounds() {
    var {x:w,y:h} = this.extent;
    return rect(0,0,w,h);
  }

  moveBy(delta) { this.position = this.position.addPt(delta); }
  resizeBy(delta) { this.extent = this.extent.addPt(delta); }

}
