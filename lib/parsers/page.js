var fs = require('fs')
var yaml = require('js-yaml')
var path = require('path')
var _ = require('lodash')
var util = require('../util')


var PAGE_FORMATS = ['.md', '.html']


function Page(attrs) {
  var fpath = attrs.fpath

  this.site = attrs.site
  this.ext = path.extname(fpath)

  this.slug = path.basename(fpath, this.ext)
  this.path = path.relative(this.site.cwd, fpath)
  this.title = util.capitalize(this.slug)

  if (this.validFormat) {
    var content = fs.readFileSync(fpath, this.site.encoding)
    var parts = content.split('---')

    if (parts.length >= 3) {
      _.extend(this, yaml.load(parts[1]))
      this.content = parts.slice(2).join('---')
      this.excerpt = this.content.slice(0, this.content.indexOf('\n\n'))
    }
  }

  this.url = '/' + (this.path.indexOf('/') >= 0 ? path.dirname(this.path) : '')
}

Object.defineProperties(Page.prototype, {
  validFormat: {
    get: function() {
      return PAGE_FORMATS.indexOf(this.ext) >= 0
    }
  },
  valid: {
    get: function() {
      return this.validFormat && !!this.content
    }
  }
})

module.exports = Page