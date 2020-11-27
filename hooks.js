const ERR = require('../../src/node_modules/async-stacktrace');
const path = require('path');
const express = require('../../src/node_modules/express');
const async = require('../../src/node_modules/async');
const padManager = require('ep_etherpad-lite/node/db/PadManager');
const authorManager = require('ep_etherpad-lite/node/db/AuthorManager');
const readOnlyManager = require('ep_etherpad-lite/node/db/ReadOnlyManager');
const Changeset = require('ep_etherpad-lite/static/js/Changeset');
eejs = require('ep_etherpad-lite/node/eejs');

exports.expressServer = function (hook_name, args, cb) {
  args.app.get('/copy', exports.onRequest);
};

exports.eejsBlock_fileMenu = function (hook_name, args, cb) {
  args.content += eejs.require('ep_copypad/templates/file.ejs', {}, module);
  return cb();
};

exports.eejsBlock_styles = function (hook_name, args, cb) {
  args.content += eejs.require('ep_copypad/templates/styles.ejs', {}, module);
  return cb();
};

exports.eejsBlock_scripts = function (hook_name, args, cb) {
  args.content += eejs.require('ep_copypad/templates/scripts.ejs', {}, module);
  return cb();
};

exports.onRequest = function (req, res) {
  exports.createCopy(req.query.old, req.query.new, req.query.old_rev, (err, padId) => {
    if (err) return res.send(err, 500);
    res.redirect(`/p/${padId}`);
  });
};


exports.formatAuthorData = function (historicalAuthorData) {
  const authors_all = [];
  for (const author in historicalAuthorData) {
    var n = historicalAuthorData[author].name;
    authors_all[n] = (authors_all[n]) ? 1 + authors_all[n] : 1;
  }

  const authors = [];
  for (var n in authors_all) {
    if (n == 'undefined') {
      authors.push('[unnamed author]');
    } else {
      authors.push(n);
    }
  }
  return authors;
};

exports.createCopy = function (oldPadId, newPadId, cloneRevNum, cb) {
  let newPad;
  let oldPad;
  const usedOldPadOd = oldPadId;
  let author_list;
  let header;
  let oldText;
  let oldAText;
  let oldPool;

  async.series([
    function (cb) {
      if (!oldPadId) return cb('No source pad specified');
      if (!newPadId) {
        newPadId = exports.randomPadName();
      }
      cb();
    },
    function (cb) {
      exports.getIds(oldPadId, (err, value) => {
        if (ERR(err, cb)) return;
        oldPadId = value.padId;
        cb();
      });
    },
    function (cb) {
      padManager.doesPadExists(oldPadId, (err, exists) => {
        if (ERR(err, cb)) return;
        if (!exists) return cb('Old pad does not exist');
        cb();
      });
    },
    function (cb) {
      padManager.doesPadExists(newPadId, (err, exists) => {
        if (ERR(err, cb)) return;
        if (exists) return cb('New pad already exist');
        cb();
      });
    },
    function (cb) {
      padManager.getPad(oldPadId, null, (err, value) => { if (ERR(err, cb)) return; oldPad = value; cb(); });
    },
    function (cb) {
      padManager.getPad(newPadId, '', (err, value) => { if (ERR(err, cb)) return; newPad = value; cb(); });
    },
    function (cb) {
      exports.buildHistoricalAuthorData(oldPad, (err, data) => {
        if (ERR(err, cb)) return;
        author_list = exports.formatAuthorData(data);
        cb();
      });
    },
    function (cb) {
      if (cloneRevNum == undefined) cloneRevNum = oldPad.getHeadRevisionNumber();
      cb();
    },
    function (cb) {
      exports.getRevisionText(oldPad, cloneRevNum, undefined, (err, value) => { if (ERR(err, cb)) return; oldText = value; cb(); });
    },
    function (cb) {
      oldPad.getInternalRevisionAText(cloneRevNum, (err, value) => { if (ERR(err, cb)) return; oldAText = value; cb(); });
    },
    function (dummy) {
      if (author_list[0] == null) author_list = ['anonymous'];
      header = `This pad builds on [[${usedOldPadOd}]], created by ${author_list.join(' & ')}\n\n`;

      const newPool = newPad.pool;
      newPool.fromJsonable(oldPad.pool.toJsonable());
      const assem = Changeset.smartOpAssembler();
      assem.appendOpWithText('+', header, [], newPool);
      Changeset.appendATextToAssembler(oldAText, assem);
      assem.endDocument();
      newPad.appendRevision(Changeset.pack(1, header.length + oldText.length + 1, assem.toString(), header + oldText));

      return cb(null, newPadId);
    },
  ]);
};


/* FIXME: These functions should be in core, but where left out when old etherpad was ported. */

/* Taken from src/templates/index.html. This should really be
 * accessible in some module, and do checking for existing names, like
 * randomUniquePadId used to do */

exports.randomPadName = function () {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const string_length = 10;
  let randomstring = '';
  for (let i = 0; i < string_length; i++) {
    const rnum = Math.floor(Math.random() * chars.length);
    randomstring += chars.substring(rnum, rnum + 1);
  }
  return randomstring;
};

exports.buildHistoricalAuthorData = function (pad, cb) {
  const historicalAuthorData = {};

  async.forEach(
      pad.getAllAuthors(),
      (authorId, cb) => {
        authorManager.getAuthor(authorId, (err, author) => {
          if (ERR(err, cb)) return;
          delete author.timestamp;
          historicalAuthorData[authorId] = author;
          cb();
        });
      },
      (err) => {
        if (ERR(err, cb)) return;
        cb(null, historicalAuthorData);
      }
  );
};


exports.getInternalRevisionText = function (pad, r, optInfoObj, cb) {
  pad.getInternalRevisionAText(r, (err, atext) => {
    if (ERR(err, cb)) return;
    const text = atext.text;
    if (optInfoObj) {
      if (text.slice(-1) != '\n') {
        optInfoObj.badLastChar = text.slice(-1);
      }
    }
    cb(null, text);
  });
};

exports.getRevisionText = function (pad, r, optInfoObj, cb) {
  exports.getInternalRevisionText(pad, r, optInfoObj, (err, internalText) => {
    if (ERR(err, cb)) return;
    cb(null, internalText.slice(0, -1));
  });
};


/**
 * returns a the padId and readonlyPadId in an object for any id
 * @param {String} padIdOrReadonlyPadId read only id or real pad id
 */
exports.getIds = function (padIdOrReadonlyPadId, callback) {
  const handleRealPadId = function () {
    readOnlyManager.getReadOnlyId(padIdOrReadonlyPadId, (err, value) => {
      callback(null, {
        readOnlyPadId: value,
        padId: padIdOrReadonlyPadId,
        readonly: false,
      });
    });
  };

  if (padIdOrReadonlyPadId.indexOf('r.') != 0) return handleRealPadId();

  readOnlyManager.getPadId(padIdOrReadonlyPadId, (err, value) => {
    if (ERR(err, callback)) return;
    if (value == null) return handleRealPadId();
    callback(null, {
      readOnlyPadId: padIdOrReadonlyPadId,
      padId: value,
      readonly: true,
    });
  });
};
