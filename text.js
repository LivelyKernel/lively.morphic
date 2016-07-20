import { string } from "lively.lang";
import { Morph, show } from "./index.js";
import { FontMetric } from "./rendering/renderer.js";

import {h} from "virtual-dom";

export class Text extends Morph {

  static makeLabel(string, props) {
    return new Text({
      textString: string,
      fontFamily: "Helvetica Neue, Arial",
      fontSize: 11,
      readOnly: true,
      ...props
    });
  }

  constructor(props) {
    super({
      readOnly: false,
      clipMode: "hidden",
      textString: "",
      fixedWidth: false, fixedHeight: false,
      draggable: false,
      _selection: { start: 0, end: 0 },
      ...props
    });
    this.fit();
    this._needsFit = false;
    this._needsSelect = false;

  }

  get fontMetric() { return FontMetric.default(); }

  get isText() { return true }

  get _nodeType() { return 'textarea'; }

  get textString() { return this.getProperty("textString") }
  set textString(value) {
    this.recordChange({prop: "textString", value: String(value)});
    this._needsFit = true;
  }

  get readOnly() { return this.getProperty("readOnly"); }
  set readOnly(value) {
    this.nativeCursor = value ? "default" : "auto";
    this.recordChange({prop: "readOnly", value});
  }

  get fixedWidth() { return this.getProperty("fixedWidth") }
  set fixedWidth(value) {
    this.recordChange({prop: "fixedWidth", value});
    this._needsFit = true;
  }

  get fixedHeight() { return this.getProperty("fixedHeight") }
  set fixedHeight(value) {
    this.recordChange({prop: "fixedHeight", value});
    this._needsFit = true;
  }

  get fontFamily() { return this.getProperty("fontFamily") }
  set fontFamily(value) {
    this.recordChange({prop: "fontFamily", value});
    this._needsFit = true;
  }

  get fontSize() { return this.getProperty("fontSize") }
  set fontSize(value) {
    this.recordChange({prop: "fontSize", value});
    this._needsFit = true;
  }

  get placeholder() { return this.getProperty("placeholder") }
  set placeholder(value) {
    this.recordChange({prop: "placeholder", value});
    this._needsFit = true;
  }

  get _selection() { return this.getProperty("_selection") }
  set _selection(value) { this.recordChange({prop: "_selection", value}); }

  get selection() { return new TextSelection(this) }

  selectionOrLineString() {
    var sel = this.selection;
    if (sel.text) return sel.text;
    var line = string.lineIndexComputer(this.textString)(sel.start),
        [start, end] = string.lineNumberToIndexesComputer(this.textString)(line);
    return this.textString.slice(start, end).trim();
  }

  aboutToRender() {
    super.aboutToRender();
    this.fitIfNeeded();
  }
  
  shape(self, style, submorphs) {
    var {
      extent: {x: width, y: height},
      fill, borderWidth, borderColor, borderRadius: br,
      reactsToPointer, nativeCursor, styleClasses, clipMode,
    } = self;
    return h("textarea", 
            {id: self.id,
             draggable: false,
             value: self.textString,
             readOnly: self.readOnly,
             placeholder: self.placeholder,
             style: {
                ...style,
                position: 'absolute',
                width: width + 'px', height: height + 'px',
                backgroundColor: fill ? fill.toString() : "",
                overflow: clipMode,
                // "box-shadow": `inset 0 0 0 ${borderWidth}px ${borderColor ? borderColor.toString() : "transparent"}`,
                // borderRadius: `${br.top()}px ${br.top()}px ${br.bottom()}px ${br.bottom()}px / ${br.left()}px ${br.right()}px ${br.right()}px ${br.left()}px`,
                cursor: nativeCursor,
                resize: "none", border: 0,
               "white-space": "nowrap", padding: "0px",
               "font-family": this.fontFamily,
               "font-size": this.fontSize + "px"
             },
             selectionStart: self._selection.start,
             selectionEnd: self._selection.end});
  }

  fit() {
    var {fixedHeight, fixedWidth} = this;
    if (fixedHeight && fixedWidth) return;

    var {fontMetric, fontFamily, fontSize, placeholder, textString} = this,
        {height: placeholderHeight, width: placeholderWidth} = fontMetric.sizeForStr(fontFamily, fontSize, placeholder || " "),
        {height, width} = fontMetric.sizeForStr(fontFamily, fontSize, textString);
    if (!fixedHeight)
      this.height = Math.max(placeholderHeight, height);
    if (!fixedWidth)
      this.width = Math.max(placeholderWidth, width);
  }

  fitIfNeeded() {
    if (this._needsFit) { this.fit(); this._needsFit = false; }
  }

  onInput(evt) {
    this.textString = evt.domEvt.target.value;
  }

  onMouseUp(evt) { this.onSelect(evt); }

  onMouseDown(evt) { this.onSelect(evt); }

  onDeselect(evt) { this.onSelect(evt) }

  onSelect(evt) {
    var { selectionStart: start, selectionEnd: end } = evt.domEvt.target;
    this._selection = { start: start, end: end };
  }

  onDeselect(evt) {
    this._selection = { start: 0, end: 0 };
  }

  onKeyUp(evt) {
    switch (evt.keyString()) {
      case 'Command-D': case 'Command-P': evt.stop(); break;
    }
  }

  async onKeyDown(evt) {
    switch (evt.keyString()) {
      case 'Command-D':
        evt.stop();
        var result = await lively.vm.runEval(this.selectionOrLineString(), {System, targetModule: "lively://test-text/1"});
        this.world()[result.isError ? "logError" : "setStatusMessage"](result.value);
        break;

      case 'Command-P':
        var sel = this.selection;
        evt.stop();
        var result = await lively.vm.runEval(this.selectionOrLineString(), {System, targetModule: "lively://test-text/1"});
        this.textString = this.textString.slice(0, sel.end) + result.value + this.textString.slice(sel.end);
        break;
    }
  }

}


class TextSelection {

  constructor(textMorph) {
    this.textMorph = textMorph;
  }

  get start() { return this.textMorph._selection.start }
  set start(val) {
    let morph = this.textMorph;
    morph._selection = { start: val, end: this.end };
    morph._needsSelect = true;
  }

  get end() { return this.textMorph._selection.end }
  set end(val) {
    let morph = this.textMorph;
    morph._selection = { start: this.start, end: val };
    morph._needsSelect = true;
  }

  get text() { return this.textMorph.textString.substring(this.start, this.end) }
  set text(val) {
    var oldText = this.textMorph.textString,
        newText = oldText.substr(0, this.start) + val + oldText.substr(this.end);
    this.textMorph.textString = newText;
  }
}
