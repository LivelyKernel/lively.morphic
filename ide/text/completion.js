/*global Map*/
import { Color, Rectangle, pt } from "lively.graphics";
import { morph, ShadowObject, StyleSheet } from "lively.morphic";
import { connect } from "lively.bindings";
import { arr, string } from "lively.lang";

import { FilterableList } from "lively.morphic/components/index.js";


export class Completer {
  compute() { return []; }
}

export class WordCompleter {

  compute(textMorph, prefix) {
    var words = [],
        completions = [],
        lines = textMorph.document.lineStrings,
        row = textMorph.cursorPosition.row,
        basePriority = 1000;

    for (var i = row; i >= 0; i--)
      for (var word of lines[i].split(/[^0-9a-z@_]+/i)) {
        if (!word || words.includes(word) || word === prefix) continue;
        words.push(word);
        completions.push({priority: basePriority-(row-i), completion: word})
      }

    for (var i = row+1; i < lines.length; i++)
      for (var word of lines[i].split(/[^0-9a-z_@]+/i)) {
        if (!word || words.includes(word) || word === prefix) continue;
        words.push(word);
        completions.push({priority: basePriority - (i-row), completion: word})
      }

    return completions;
  }

}

export var defaultCompleters = [
  new WordCompleter()
]

// -=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-=-

export class CompletionController {

  constructor(textMorph, completers = []) {
    this.textMorph = textMorph;
    completers = textMorph.pluginCollect("getCompleters", completers);
    this.completers = completers;
  }

  async computeCompletions(prefix) {
    var completions = [];
    for (var c of this.completers)
      try {
        completions = completions.concat(await c.compute(this.textMorph, prefix));
      } catch (e) {
        console.warn(`Error in completer ${c}: ${e.stack || e}`);
      }

    // if multiple options with same completion exist, uniq by the highest priority
    // note: there is a lively.lang bug that breaks groupBy if key === constructor...!
    var groups = new Map();
    completions.forEach(ea => {
      var group = groups.get(ea.completion);
      if (!group) { group = []; groups.set(ea.completion, group); }
      group.push(ea);
    });

    var withHighestPriority = [];
    for (let val of groups.values())
      withHighestPriority.push(arr.last(arr.sortByKey(val, "priority")))

    var maxCol = 0,
        sorted = arr.sortByKey(withHighestPriority, "priority").reverse(),
        highestPriority = (sorted.length && sorted[0].priority) || 0,
        items = sorted.map(ea => {
          ea.highestPriority = highestPriority;
          var string = ea.completion.replace(/\n/g, ""),
              annotation = String((ea.info || "").replace(/\n/g, ""));
          maxCol = Math.max(maxCol, string.length + annotation.length)
          return {isListItem: true, string, annotation, value: ea};
        });
    return {items, maxCol}
  }

  prefix() {
    let m = this.textMorph,
        sel = m.selection,
        roughPrefix = sel.isEmpty() ? m.getLine(sel.lead.row).slice(0, sel.lead.column) : sel.text;
    return roughPrefix.match(/[a-z0-9@_]*$/i)[0];
  }

  positionForMenu() {
    let m = this.textMorph,
        cursorBounds = m.charBoundsFromTextPosition(m.cursorPosition),
        globalCursorBounds = m.getGlobalTransform().transformRectToRect(cursorBounds);
    return globalCursorBounds.topLeft()
      .addXY(-m.padding.left(), -m.padding.top())
      .addXY(-m.scroll.x, -m.scroll.y)
      .addPt(pt(m.borderWidth + 2, m.borderWidth));
  }

  async completionListSpec() {
    let m = this.textMorph,
        {fontSize, fontFamily} = m,
        position = this.positionForMenu(),
        prefix = this.prefix(),
        {items, maxCol} = await this.computeCompletions(prefix),
        charBounds = m.env.fontMetric.sizeFor(fontFamily, fontSize, "M"),
        minWidth = 120,
        textWidth = charBounds.width*maxCol,
        width = Math.max(minWidth, textWidth < m.width ? textWidth : m.width),
        minHeight = 70, maxHeight = 700,
        fullHeight = charBounds.height*items.length+charBounds.height+10,
        height = Math.max(minHeight, Math.min(maxHeight, fullHeight)),
        bounds = position.extent(pt(width, height));

    // ensure menu is visible
    let world = m.world();
    if (world) {
      let visibleBounds = world.visibleBounds().insetBy(5);
      if (bounds.bottom() > visibleBounds.bottom()) {
        let delta = bounds.bottom() - visibleBounds.bottom();
        if (delta > bounds.height-50) delta = bounds.height-50;
        bounds.height -= delta;
      }
      if (bounds.right() > visibleBounds.right()) {
        let delta = bounds.right() - visibleBounds.right();
        if (bounds.width-delta < minWidth) bounds.width = minWidth;
        else bounds.width -= delta;
      }
      if (!visibleBounds.containsRect(bounds))
        bounds = bounds.withTopLeft(visibleBounds.translateForInclusion(bounds).topLeft());
    }

    return {
      styleSheets: new StyleSheet({
        "[name=input]": {
          fill: Color.transparent
        },
        ".ListItemMorph": {
          fontFamily,
          fontSize
        }
      }),      fontFamily, fontSize,
      position: bounds.topLeft(),
      extent: bounds.extent(),
      items, input: prefix,
      name: "text completion menu",
      historyId: "lively.morphic-text completion",
      fill: Color.transparent,
      border: {width: 0, color: Color.gray},
      inputPadding: Rectangle.inset(0, 2),

      filterFunction: (parsedInput, item) => {
        var tokens = parsedInput.lowercasedTokens;
        if (tokens.every(token => item.string.toLowerCase().includes(token))) return true;
        // "fuzzy" match
        var completion = item.value.completion.replace(/\([^\)]*\)$/, "").toLowerCase();
        return arr.sum(parsedInput.lowercasedTokens.map(token =>
                string.levenshtein(completion, token))) <= 3;
      },

      sortFunction: (parsedInput, item) => {
        // Preioritize those completions that are close to the input. We also
        // want to consider the static priority of the item itself but adjust it
        // across the priority of all items
        var {highestPriority, completion, priority} = item.value,
            completion = completion.replace(/\([^\)]*\)$/, "").toLowerCase(),
            n = String(highestPriority).length-2,
            adjustedPriority = priority / 10**n,
            base = -adjustedPriority;
        parsedInput.lowercasedTokens.forEach(t => {
          if (completion.startsWith(t)) base -= 12;
          else if (completion.includes(t)) base -= 5;
        });
        return arr.sum(parsedInput.lowercasedTokens.map(token =>
          string.levenshtein(completion.toLowerCase(), token))) + base
      }
    }
  }

  async openCompletionList() {
    let spec = await this.completionListSpec(),
        menu = new FilterableList(spec),
        input = menu.inputMorph,
        list = menu.listMorph,
        prefix = spec.input,
        mask = menu.addMorph({
          name: 'prefix mask',
          bounds: input.textBounds() 
        }, input);

    connect(input, 'textString', mask, 'setBounds', {
      converter: () => input.textBounds(),
      varMapping: {input}
    });
    connect(menu, "accepted", this, "insertCompletion", {
      updater: function($upd) {
        let textToInsert, customInsertionFn = null, completion = this.sourceObj.selection;
        if (completion) {
          if (completion.prefix) prefix = completion.prefix;
          textToInsert = completion.completion;
          customInsertionFn = completion.customInsertionFn;
        } else {
          textToInsert = this.sourceObj.inputMorph.textString;
        }
        $upd(textToInsert, prefix, customInsertionFn);
      },
      varMapping: {prefix}
    });
    connect(menu, "accepted", menu, "remove");
    connect(menu, "canceled", menu, "remove");
    connect(menu, "remove", this.textMorph, "focus");

    var world = this.textMorph.world();
    world.addMorph(menu);

    list.dropShadow = new ShadowObject({rotation: 45, distance: 2, blur: 2, color: Color.gray.darker()});
    list.fill = Color.white.withA(0.85);
    list.addStyleClass("hiddenScrollbar");

    input.height = list.itemHeight;
    input.fixedHeight = true;
    input.focus();

    menu.get("padding").height = 0;
    menu.relayout();
    menu.selectedIndex = 0;
    if (prefix.length) {
      input.gotoDocumentEnd();
      menu.moveBy(pt(-input.textBounds().width + 2, 0));
    } else {
      menu.moveBy(pt(2, 0));
    }
    return menu;
  }

  insertCompletion(completion, prefix, customInsertionFn) {
    var m = this.textMorph, doc = m.document,
        selections = m.selection.isMultiSelection ?
          m.selection.selections : [m.selection];
    m.undoManager.group();
    selections.forEach(sel => {
      sel.collapseToEnd();
      var end = sel.lead,
          start = prefix ?
            doc.indexToPosition(doc.positionToIndex(end) - prefix.length) : end;
      typeof customInsertionFn === "function" ?
        customInsertionFn(completion, prefix, m, {start, end}, sel) :
        m.replace({start, end}, completion);
    });
    m.undoManager.group();
  }

}


export var completionCommands = [{
  name: "text completion",
  handlesCount: true, // to ignore and not open multiple lists
  multiSelectAction: "single",
  async exec(morph, opts, count) {
    var completer = new CompletionController(morph, defaultCompleters);
    await completer.openCompletionList();
    return true;
  }
}];