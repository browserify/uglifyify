var minimatch = require('minimatch').Minimatch
  , convert = require('convert-source-map')
  , through = require('through')
  , path = require('path')
  , xtend = require('xtend')

module.exports = uglifyify

function uglifyify(file, opts) {
  opts = xtend(opts || {})

  var debug = opts._flags && opts._flags.debug
  // lazy require `terser` so uglifyify can be loaded on very old node.js versions
  var ujs = opts.uglify || require('terser')

  if (ignore(file, opts.ignore)) {
    return through()
  }

  var buffer = ''
  var exts = []
    .concat(opts.exts || [])
    .concat(opts.x || [])
    .map(function(d) {
      if (d.charAt(0) === '.') return d
      return '.' + d
    })

  if (
    /\.json$/.test(file) ||
    exts.length &&
    exts.indexOf(path.extname(file)) === -1
  ) {
    return through()
  }

  // remove exts before passing opts to uglify
  delete opts.global
  delete opts.exts
  delete opts.x
  delete opts.uglify

  return through(function write(chunk) {
    buffer += chunk
  }, capture(function ready() {
    var stream = this
    debug = opts.sourceMap !== false && debug
    opts  = xtend({
      compress: true,
      mangle: true,
      sourceMap: {
        filename: file
      }
    }, opts)

    // map out command line options to uglify compatible ones
    mapArgv(opts)

    if (typeof opts.compress === 'object') {
      opts.compress = xtend(opts.compress || {})
      delete opts.compress._
    }

    if (debug) opts.sourceMap.url = 'out.js.map'

    // Check if incoming source code already has source map comment.
    // If so, send it in to ujs.minify as the inSourceMap parameter
    if (debug) {
      opts.sourceMap.content = 'inline'
    }

    return Promise.resolve(ujs.minify(buffer, opts)).then(function (min) {
      // we should catch the min error if it comes back and end the stream
      if (min.error) throw min.error

      // Uglify leaves a source map comment pointing back to "out.js.map",
      // which we want to get rid of because it confuses browserify.
      min.code = min.code.replace(/\/\/[#@] ?sourceMappingURL=out.js.map$/, '')
      stream.queue(min.code)

      if (min.map && min.map !== 'null') {
        var map = convert.fromJSON(min.map)

        map.setProperty('sources', [path.basename(file)])

        stream.queue('\n')
        stream.queue(map.toComment())
      }

      stream.queue(null)
    }, function (err) {
      stream.emit('error', err)
    })
  }))

  function capture(fn) {
    return function() {
      var stream = this
      try {
        fn.apply(stream, arguments).catch(function (err) {
          return stream.emit('error', err)
        })
      } catch(err) {
        return stream.emit('error', err)
      }
    }
  }
}

function ignore(file, list) {
  if (!list) return

  list = Array.isArray(list) ? list : [list]

  return list.some(function(pattern) {
    var match = minimatch(pattern)
    return match.match(file)
  })
}

// uglify-es doesn't allow for command line options in javascript api, this
// remaps it
function mapArgv (opts) {
  if (opts._flags) {
    delete opts._flags
  }
  if (opts.c) {
    opts.compress = opts.c
    delete opts.c
  }
  if (opts.m) {
    opts.mangle = opts.m
    delete opts.m
  }
  if (opts.p) {
    opts.parse = opts.p
    delete opts.p
  }
  if (opts.b) {
    opts.beautify = opts.b
    delete opts.b
  }
  if (opts.o) {
    opts.output = opts.o
    delete opts.o
  }
  if (opts.d) {
    opts.define = opts.d
    delete opts.d
  }
  delete opts._
}
