const convert = require('convert-source-map')
const wrap = require('wrap-stream')
const browserify = require('browserify')
const from2 = require('from2-string')
const test = require('tape')
const path = require('path')
const uglifyify = require('../')
const fs = require('fs')
const bl = require('bl').BufferListStream

let uglify
try {
  uglify = require('terser')
} catch (_err) {
  // The terser version we use by default requires Node.js 10+
  uglify = require('uglify-js')
}

test('uglifyify: sanity check', function (t) {
  const src = path.join(__dirname, 'fixture.js')
  const orig = fs.readFileSync(src, 'utf8')

  fs.createReadStream(src)
    .pipe(uglifyify(src, { uglify }))
    .pipe(bl(function (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.notEqual(data.indexOf('var hello'), -1, 'var hello')
      t.notEqual(data.indexOf('"world"'), -1, '"world"')
      t.notEqual(data, orig, 'should be minified')
      t.end()
    }))
})

test('uglifyify: ignores json', function (t) {
  const src = path.join(__dirname, 'fixture.js')
  const json = path.join(__dirname, 'fixture.json')
  const orig = fs.readFileSync(src, 'utf8')

  fs.createReadStream(src)
    .pipe(uglifyify(json, { uglify }))
    .pipe(bl(buffered))

  function buffered (err, data) {
    if (err) return t.ifError(err)
    data = String(data)
    t.equal(data, orig, 'should not be minified')
    t.end()
  }
})

test('uglifyify: -t [ uglifyify --exts ]', function (t) {
  const src = path.join(__dirname, 'fixture.js')
  const orig = fs.readFileSync(src, 'utf8')

  t.plan(5)

  check(path.join(__dirname, 'fixture.json'), true)
  check(path.join(__dirname, 'fixture.obj2'), false)
  check(path.join(__dirname, 'fixture.mkdn'), false)
  check(path.join(__dirname, 'fixture.fbla'), true)
  check(src, true)

  function check (name, ignored) {
    fs.createReadStream(src)
      .pipe(uglifyify(name, { exts: ['mkdn'], x: ['.obj2'], uglify }))
      .pipe(bl(buffered))

    function buffered (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.ok(ignored
        ? data === orig
        : data !== orig
      , path.extname(name) + ' handled as expected')
    }
  }
})

test('uglifyify: passes options to uglify', function (t) {
  const src = path.join(__dirname, 'fixture.js')
  const orig = fs.readFileSync(src, 'utf8')
  let buf1 = null

  fs.createReadStream(src)
    .pipe(closure())
    .pipe(uglifyify(src, { compress: { conditionals: false }, uglify }))
    .pipe(bl(buffered1))

  function buffered1 (err, _buf1) {
    if (err) return t.ifError(err)
    buf1 = String(_buf1)
    t.notEqual(buf1, orig, 'should be minified')

    fs.createReadStream(src)
      .pipe(closure())
      .pipe(uglifyify(src, { uglify }))
      .pipe(bl(buffered2))
  }

  function buffered2 (err, buf2) {
    if (err) return
    buf2 = String(buf2)
    t.notEqual(buf2, orig, 'should be minified')
    t.notEqual(buf1, buf2, 'options altered output')
    t.end()
  }
})

function closure () {
  return wrap('(function(){', '})()')
}

test('uglifyify: sourcemaps', function (t) {
  t.plan(10)

  const src = path.join(__dirname, 'fixture.js')
  const json = path.join(__dirname, 'fixture.json')
  const orig = fs.readFileSync(src, 'utf8')
  Promise.resolve(uglify.minify(orig, {
    sourceMap: {
      url: 'out.js.map'
    }
  })).then(function (min) {
    const map = convert.fromJSON(min.map)
    map.setProperty('sources', [src])
    map.setProperty('sourcesContent', [orig])

    const mapped = [orig, map.toComment()].join('\n')

    from2(mapped)
      .pipe(uglifyify(json, { uglify }))
      .pipe(bl(doneWithMap))

    from2(orig)
      .pipe(uglifyify(json, { uglify }))
      .pipe(bl(doneWithoutMap))

    browserify({ entries: [src], debug: true })
      .transform(uglifyify, { uglify })
      .bundle()
      .pipe(bl(doneWithMap))

    browserify({ entries: [src], debug: false })
      .transform(uglifyify, { uglify })
      .bundle()
      .pipe(bl(doneWithoutDebug))

    from2(mapped)
      .pipe(uglifyify(json, { _flags: { debug: false }, uglify }))
      .pipe(bl(doneWithMapAndNoDebug))

    function doneWithMap (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.notEqual(data, orig, 'should have changed')
      t.equal(data.match(/\/\/[@#]/g).length, 1, 'should have sourcemap')
    }

    function doneWithoutMap (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.equal(data, orig, 'should not have changed')
      t.equal(data.indexOf(/\/\/[@#]/g), -1, 'should not have sourcemap')
    }

    function doneWithoutDebug (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.notEqual(data, orig, 'should have changed')
      t.equal(data.indexOf(/\/\/[@#]/g), -1, 'should not have sourcemap')
    }

    function doneWithMapAndNoDebug (err, data) {
      if (err) return t.ifError(err)
      data = String(data)
      t.notEqual(data, orig, 'should have changed')
      t.equal(data.match(/\/\/[@#]/g).length, 1, 'should have sourcemap')
    }
  }, function (err) {
    t.ifError(err)
  })
})

test('uglifyify: transform is stable', function (t) {
  t.plan(1)

  const src = path.join(__dirname, 'fixture.js')
  const opts = {
    uglify,
    _flags: {
      debug: false
    }
  }

  const tr1 = fs.createReadStream(src).pipe(uglifyify(src, opts))
  const tr2 = fs.createReadStream(src).pipe(uglifyify(src, opts))

  tr1.pipe(bl(function (err, data) {
    if (err) return t.ifError(err)
    const data1 = String(data)

    tr2.pipe(bl(function (err, data) {
      if (err) return t.ifError(err)
      const data2 = String(data)

      t.equal(data2, data1, 'repeated runs should be the same')
      t.end()
    }))
  }))
})
