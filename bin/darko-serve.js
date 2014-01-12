#!/usr/bin/env node


var program = require('commander')


program
  .option('-s --source [source]', 'Source directory (default to ./)', './')
  .option('-d --destination [dest]', 'Destination directory (default to ./_site)', './_site')
  .option('--config [CONFIG_FILE[,CONFIG_FILE2,...]]', 'Custom configuration file', function(config) {
    return config.split(',')
  })
  .option('--future', 'Publishes posts with a future date')
  .option('--limit_posts [MAX_POSTS]', 'Limits the number of posts to parse and build')
  .option('-w --watch', 'Watch for changes and rebuild')
  .option('--lsi')
  .option('-D --drafts', 'Render posts in the _drafts folder')
  .option('-V --verbose', 'Print verbose output')
  .option('-t --trace', 'Display backtrace when an error occur', false)
  .option('-B --detach', 'Run the server in the background')
  .option('-P --port [port]', 'Port to listen on', parseInt, '4100')
  .option('-H --host [host]', 'Host to bind to', '0.0.0.0')
  .option('-b --baseurl [baseurl]', 'Base URL')

program.on('--help', function() {
  console.log('  Examples:')
  console.log('')
  console.log('    $ darko serve --watch')
  console.log('    $ darko serve -P 4000 -b docs')
  console.log('')
})

program.parse(process.argv)


if (program.verbose) {
  process.env.DEBUG = 'darko,' + (process.env.DEBUG || '')
}

var http = require('http')
var path = require('path')
var fs = require('fs')
var debug = require('debug')('darko')
var Site = require('..').Site
var Post = require('..').Post
var Page = require('..').Page
var util = require('..').util


var site = new Site({
  cwd: program.source,
  dest: program.destination,
  includeDrafts: program.drafts,
  includeFuture: program.future,
  baseurl: program.baseurl,
  config: program.config
})

process.stdin.resume()

site.parse()
site.write()
  .fail(function(err) {
    if (program.trace) console.error(err.stack)
    else util.fatal(err.message)
  })
  .done(serve)

if (program.watch) watch()

function serve() {
  http.createServer(handle).listen(program.port, program.host, function() {
    util.log('Server address', 'http://127.0.0.1:' + program.port)
    util.log('Server running', 'press ctrl-c to stop')
  })
}

function handle(req, res) {

  function sendFile(fpath) {
    debug('Sending ' + fpath)
    fs.createReadStream(fpath)
      .pipe(res)
  }

  var droot = path.join(__dirname, '../server')
  var dprefix = '/~darko/'
  var fpath
  var f404

  if (req.url.indexOf(dprefix) == 0)
    fpath = path.join(droot, req.url.slice(dprefix.length))
  else
    fpath = path.join(site.dest, req.url.slice(1))

  if (!fs.existsSync(fpath)) {
    res.statusCode = 404
    res.setHeader('Content-Type', 'text/html')

    f404 = path.join(site.dest, '404.html')
    if (!fs.existsSync(f404)) f404 = path.join(droot, '404.html')

    fs.createReadStream(f404)
      .pipe(res)

    return
  }

  var stats = fs.statSync(fpath)

  if (stats.isFile()) {
    sendFile(fpath)
  }
  else if (stats.isDirectory()) {
    fpath = path.join(fpath, 'index.html')

    if (fs.existsSync(fpath)) sendFile(fpath)
  }
}

function watch() {
  util.log('Auto-regeneration', 'enabled')

  site.posts.map(function(post) {
    return path.dirname(path.join(site.cwd, post.path))
  }).reduce(function(dirs, dir) {
    if (dirs.indexOf(dir) < 0) dirs.push(dir)
    return dirs
  }, []).forEach(watchPost)

  function walk(dir) {
    watchOther(dir)

    fs.readdir(dir, function(err, entries) {
      entries.forEach(function(entry) {
        if ('.' == entry.charAt(0) ||
            '_posts' == entry ||
            '_drafts' == entry ||
            '_site' == entry ||
            'node_modules' == entry)
          return

        var fpath = path.join(dir, entry)
        var stats = fs.statSync(fpath)

        if (stats.isDirectory()) walk(fpath)
      })
    })
  }

  walk(site.cwd)
}

function watchPost(dir) {
  debug('Watching for posts in ' + dir)
  fs.watch(dir, function(e, fname) {
    debug('Detected ' + e + ' in ' + dir)
    if (filename) {
      debug('Filename is told: ' + fname)
      updatePost(path.join(dir, fname))
    }
    else mark(dir)
  })
}

function watchOther(dir) {
  debug('Watching for others in ' + dir)
  fs.watch(dir, function(e, fname) {
    if (fname) {
      var fpath = path.join(dir, fname)

      debug('Detected ' + e + ' of ' + fname)
      if (/\.(md|html)$/.test(fname)) updatePage(new Page({ fpath: fpath, site: site }))
      else if (!/^[._]/.test(fname)) updateStatic(fpath)
    }
    else {
      // TODO: Need to find the very file that was changed
    }
  })
}

var _changes = []

function mark(dir) {
  // In Mac, the listener of fs.watch will be triggerred twice when a file
  // under the directory being watched is modified.
  //
  // The e parameter will be `change' at first, then will be 'rename', which is
  // nonsense because there was only one file being changed.
  //
  // So we pospond the mark function, just to eliminate duplicates early.
  //
  if (_changes.indexOf(dir) < 0) {
    _changes.push(dir)
    setImmediate(_mark, 100)
  }
}

function _mark() {
  var dir = _changes.shift()
  var entry = fs.readdirSync(dir).map(function(entry) {
    // http://en.wikipedia.org/wiki/Stat_(system_call)
    // http://nodejs.org/api/fs.html#fs_class_fs_stats
    //
    // What's the difference of ctime, mtime, and atime?
    //
    return [entry, fs.statSync(path.join(dir, entry)).mtime]
  }).sort(function(a, b) {
    return b[1].getTime() - a[1].getTime()
  })[0][0]

  updatePost(new Post({ fpath: path.join(dir, entry), site: site }))
}

function updatePage(page) {
  var fpath = path.join(site.cwd, page.path)

  if (fs.existsSync(fpath)) {
    debug('Changed ' + fpath)
    if (page.publishable) {
      util.replace(site.pages, function(_page) {
        return _page.path == page.path ? page : _page
      })
      site.writeTemplated(page).done(function() {
        util.log('Regenerated', page.path)
      })
    }
  }
  else {
    debug('Removed ' + fpath)
    util.remove(site.pages, function(_page) {
      return _page.path == page.path
    })
    fs.unlinkSync(page.dest)
    util.log('Removed ', path.relative(site.dest, page.dest))
  }
}

function updateStatic(fpath) {
  var fname = path.relative(site.cwd, fpath)

  fs.createReadStream(fpath)
    .pipe(fs.createWriteStream(path.join(site.dest, fname)))
    .on('error', function(err) {
      util.error('Failed to copy ' + fname)
      util.error(err.message)
      if (program.trace) util.error(err.stack)
    })
    .on('finish', function() {
      debug('Copied file ' + fname)
    })
}
