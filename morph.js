import { Color, pt, rect } from "lively.graphics";

const defaultProperties = {
  position:  pt(0,0),
  rotation:  0,
  scale:  1,
  extent:  pt(10, 10),
  fill:  Color.white,
  clipMode:  "visible",
  submorphs:  []
}

export class Morph {

  constructor(props) {
    this._owner = null;
    this._changes = []
    this._pendingChanges = [];
    this._dirty = true; // for initial display
    this._propCache = {}
    Object.assign(this, props);
  }

  defaultProperty(key) { return defaultProperties[key]; }

  getProperty(key) {
     var c = this.lastChangeFor(key);
     return c ? c.value : this.defaultProperty(key); 
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // changes
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  lastChangeFor(prop, onlyCommited) {
    if (this._propCache[prop]) return this._propCache[prop];
    for (var i = this._pendingChanges.length - 1; i >= 0; i--)
      if (this._pendingChanges[i].prop === prop) return this._propCache[prop] = this._pendingChanges[i];
    for (var i = this._changes.length - 1; i >= 0; i--)
      if (this._changes[i].prop === prop) return this._propCache[prop] = this._changes[i];
    return null;
  }

  change(change) {
    this._propCache[change.prop] = change;
    this._pendingChanges.push(change);
    this.makeDirty();
    return change;
  }

  hasPendingChanges() { return !!this._pendingChanges.length; }

  commitChanges() {
    this._changes = this._changes.concat(this._pendingChanges);
    this._pendingChanges = [];
    if (this._changes.length > 1000) this.compactChanges();
  }

  compactChanges() {
    var seen = {};
    this._changes = this._changes.reduceRight((changes, change) => {
      if (!(change.prop in seen)) {
        changes.push(change);
        seen[change.prop] = true;
      }
      return changes;
    }, []);
    this._propCache = {};
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // render hooks
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  makeDirty() {
    this._dirty = true;
    if (this.owner) this.owner.makeDirty();
  }

  needsRerender() {
    return this._dirty || !!this._pendingChanges.length;
  }
  
  aboutToRender() {
    this.commitChanges();
    this._dirty = false;
  }

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-
  // morphic interface
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  get position()       { return this.getProperty("position"); }
  set position(value)  { this.change({prop: "position", value}); }

  get scale()          { return this.getProperty("scale"); }
  set scale(value)     { this.change({prop: "scale", value}); }

  get rotation()       { return this.getProperty("rotation"); }
  set rotation(value)  { this.change({prop: "rotation", value}); }

  get extent()         { return this.getProperty("extent"); }
  set extent(value)    { this.change({prop: "extent", value}); }

  get fill()           { return this.getProperty("fill"); }
  set fill(value)      { this.change({prop: "fill", value}); }

  get clipMode()       { return this.getProperty("clipMode"); }
  set clipMode(value)  { this.change({prop: "clipMode", value}); }

  get submorphs()      { return this.getProperty("submorphs"); }
  addMorph(morph) {
    morph._owner = this;
    this.change({prop: "submorphs", value: this.submorphs.concat(morph)});
    return morph;
  }
  remove() {
    var o = this.owner;
    if (o) {
      this._owner = null;
      o.change({prop: "submorphs", value: o.submorphs.filter(ea => ea !== this)});
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

  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-  
  // undo / redo
  // -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

  undo() {
    // fixme redo stack
    this._changes.pop();
    this.makeDirty();
  }
}
