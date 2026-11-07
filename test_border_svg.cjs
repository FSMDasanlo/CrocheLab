const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = __dirname;
const windowContext = {
  document: {
    createElementNS: function(ns, name) {
      return {
        name: name,
        attrs: {},
        childNodes: [],
        setAttribute: function(k, v) { this.attrs[k] = String(v); },
        appendChild: function(c) { this.childNodes.push(c); },
        outerHTML: ""
      };
    },
    importNode: function(node, deep) { return node; }
  },
  DOMParser: function() {
    return {
      parseFromString: function(str, mime) {
        return { documentElement: { childNodes: [{ raw: str }] } };
      }
    };
  }
};

vm.runInNewContext(fs.readFileSync(path.join(root, 'js', 'stitch-catalog.js'), 'utf8'), { window: windowContext });
console.log('Stitch catalog loaded with', windowContext.CrocheLabSymbols.all().length, 'symbols');
