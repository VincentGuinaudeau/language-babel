/*global atom*/
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const CompositeDisposable = require('atom').CompositeDisposable;

// This Class is repsonsible for creating a new Tagged Template grammar
// on detection of a changed Tagged Template Configuration in the package settings
module.exports =
class CreateTtlGrammar {

  disposable = new CompositeDisposable();
  configChangedTimer= null;
  TTL_GRAMMAR_NAME = 'language-babel-extension';
  TTL_SCOPENAME = `languagebabel.ttlextension`;

  constructor(observeConfig = false) {
    if (observeConfig)   {
      // look for changes in tagged template handlers
      this.disposable.add(atom.config.observe('language-babel.taggedTemplateGrammar', this.observeTtlConfig.bind(this, 10000)));
    }
  }

  destroy() {
    this.disposable.dispose();
  }

  // add new grammars to registry
  addGrammars(filename) {
    return new Promise((resolve, reject) => {
      atom.grammars.loadGrammar(filename, (err) => {
        if (err) {
          reject(new Error(`Unable to add Grammar to registry\n${filename}`));
        }
        else resolve();
      });
    });

  }

  // Check if the grammar exists under this SHA256 file name
  // If not then remove all ttl grammars and create a new one
  // This returns a Promise that resolves  with a ttl filename
  // if a new grammar was created or rejects if a problem.
  createGrammar({ttlFilename, ttlFilenameAbsolute, grammarText}) {
    return new Promise((resolve, reject) => {
      this.doesGrammarFileExist(ttlFilename)
        .then((ifFileExists) => {
          if (ifFileExists) {
            resolve();
          }
          else {
            this.removeGrammars();
            this.removeTtlLanguageFiles()
            .then(() => this.createGrammarFile(ttlFilenameAbsolute, grammarText))
            .then(() => this.addGrammars(ttlFilenameAbsolute))
            .then(() => {
              atom.notifications.addInfo('language-babel', {detail: `Grammar created at \n${ttlFilenameAbsolute}`,dismissable: true});
              resolve(ttlFilename);
            })
            .catch((err) => {
              atom.notifications.addWarning('language-babel', {detail: `${err.message}`,dismissable: true});
              reject(err);
            });
          }
        });
    });
  }

  // write the ttl grammar file for this config
  createGrammarFile(filename,text) {
    return new Promise((resolve, reject) => {
      fs.writeFile(filename, text, (err) => {
        if (err) reject(new Error(err));
        else resolve();
      });
    });
  }

  // create a Grammar file's JSON text
  createGrammarText() {
    return `{
  "name": "${this.TTL_GRAMMAR_NAME}",
  "comment": "Auto generated Tag Extensions for language-babel",
  "comment": "Please do not edit this file directly",
  "scopeName": "${this.TTL_SCOPENAME}",
  "fileTypes": [],
  "patterns": [
    ${this.getTtlConfig().map((ttlString) => (this.createGrammarPatterns(ttlString)))}
  ]
}`;
  }

  // Create a grammar's pattern derived from a the tagged template string
  // in the form matchString:includeScope
  createGrammarPatterns(ttlString) {
    let lastColonIndex = ttlString.lastIndexOf(':');
    let matchString = ttlString.substring(0, lastColonIndex);
    let includeScope = ttlString.substring(lastColonIndex+1);
    const isValidIncludeScope = /^([a-zA-Z]\w*\.?)*(\w#([a-zA-Z]\w*\.?)*)?\w$/.test(includeScope);
    const isQuotedMatchString = /^\".*\"$/.test(matchString);

    if (matchString.length < 1 || !isValidIncludeScope) {
      throw new Error(`Error in the Tagged Template Grammar String ${ttlString}`);
    }

    if ( isQuotedMatchString ) {
      // Found a possible regexp in the form "regex" so strip the "
      matchString = matchString.substring(1, matchString.length -1);
      try {
        // We need to call oniguruma's constructor via this convoluted method as I can't include
        // the github/atom/node-oniguruma package as npm on Windows get node-gyp errors unless a
        // user has installed a compiler. Find Atom's Oniguruma and call the constructor.
        if (typeof atom.grammars.grammars === "object") {
          atom.grammars.grammars.every((obj) => {
            if (obj.packageName === "language-babel") {
              let ref, ref1, ref2;
              if ((ref = obj.firstLineRegex) != null) {
                if ((ref1 = ref.scanner) != null) {
                  if ((ref2 = ref1.__proto__) != null) {
                    if (typeof ref2.constructor === "function") {
                      // Change JSON/JS type string to a valid regex
                      let onigString = matchString.replace(/\\\\/g,"\\"); // double slashes to single
                      onigString = onigString.replace(/\\"/g,"\""); // escaped quote to quote
                      // now call new obj.firstLineRegex.scanner.__proto__.constructor([onigString]);
                      // to validate the regex
                      new ref2.constructor([onigString]);
                    }
                  }
                }
              }
              return false;
            }
            else return true;
          });
        }
      }
      catch (err) {
        throw new Error(`You entered an badly formed RegExp in the Tagged Template Grammar settings.\n${matchString}\n${err}`);
      }
    }
    else if ( /"/g.test(matchString)) {
      throw new Error(`Bad literal string in the Tagged Template Grammar settings.\n${matchString}`);
    }
    else {
      // User entered a literal string which may contain chars that a special inside a regex.
      // Escape any special chars e.g. '/** @html */' -> '\/\*\* @html \*\/'
      // The string stored by Atom in the config has the \\ already escaped.
      const escapeStringRegExp = /[|{}()[\]^$+*?.]/g;
      const preEscapedSlash = /\\/g;
      matchString = matchString.replace(preEscapedSlash, '\\\\\\\\');
      matchString = matchString.replace(escapeStringRegExp, '\\\\$&');
    }

    return `{
      "contentName": "${includeScope.match(/^[^#]*/)[0]}",
      "begin": "\\\\s*+(${matchString})\\\\s*(\`)",
      "beginCaptures": {
        "1": { "name": "entity.name.tag.js" },
        "2": { "name": "punctuation.definition.quasi.begin.js" }
      },
      "end": "\\\\s*(?<!\\\\\\\\)(\`)",
      "endCaptures": {
        "1": { "name": "punctuation.definition.quasi.end.js" }
      },
      "patterns": [
        { "include": "source.js.jsx#literal-quasi-embedded" },
        { "include": "${includeScope}" }
      ]
    }`;
  }

  // checks a ttl grammar filename exists
  // returns a Promise that resolves to true if ttlFileName exists
  doesGrammarFileExist(ttlFilename) {
    return new Promise((resolve) => {
      fs.access(this.makeTtlGrammarFilenameAbsoulute(ttlFilename), fs.F_OK, (err) => {
        err ? resolve(false): resolve(true);
      });
    });
  }

  // get full path to the language-babel grammar file dir
  getGrammarPath() {
    return path.normalize(
      path.resolve(atom.packages.loadedPackages['language-babel'].path, './grammars')
    );
  }

  // get an array of all language-babel grammar files
  getGrammarFiles() {
    return new Promise((resolve,reject) => {
      fs.readdir(this.getGrammarPath(),(err, data) => {
        if (err) reject(new Error(err));
        else {
          resolve(data);
        }
      });
    });
  }

  // read configurations for tagged templates
  getTtlConfig() {
    return atom.config.get('language-babel').taggedTemplateGrammar;
  }

  // get an array of grammar tagged template extension filenames
  getTtlGrammarFiles() {
    return this.getGrammarFiles().then(dirFiles => dirFiles.filter(function(filename) {
      return /^ttl-/.test(filename);
    }));
  }

  // generate a SHA256 for some text
  generateTtlSHA256(stringToHash) {
    let hash = crypto.createHash('sha256');
    hash.update(stringToHash);
    return hash.digest('hex');
  }

  // tagged template filename
  makeTtlGrammarFilename(hashString) {
    return `ttl-${hashString}.json`;
  }

  // get a fully qualified filename
  makeTtlGrammarFilenameAbsoulute(ttlFilename) {
    return path.resolve(this.getGrammarPath(), ttlFilename);
  }


  // observe changes in the taggedTemplateGrammar config which take place
  // because observed config changes are fired as a user types them inside
  // settings we need to delay processing the array strings, until last char
  // entered was setTimeout seconds ago. parse tagged template configuration
  // and then create grammar and generate a SHA256 hash from the grammar
  observeTtlConfig(timeout) {
    if (this.configChangedTimer) clearTimeout(this.configChangedTimer);
    this.configChangedTimer = setTimeout(() => {
      try {
        const grammarText = this.createGrammarText();
        const hash = this.generateTtlSHA256(grammarText);
        const ttlFilename = this.makeTtlGrammarFilename(hash);
        const ttlFilenameAbsolute = this.makeTtlGrammarFilenameAbsoulute(ttlFilename);
        this.createGrammar({ttlFilename, ttlFilenameAbsolute, grammarText});
      }
      catch(err) {
        atom.notifications.addWarning('language-babel', {detail: `${err.message}`,dismissable: true});
      }
    }, timeout);
  }

  // Remove grammars before upodating
  removeGrammars() {
    atom.grammars.removeGrammarForScopeName(this.TTL_SCOPENAME);
  }

  // remove all language files in tagged template GrammarFiles array
  removeTtlLanguageFiles() {
    return this.getTtlGrammarFiles().then((ttlGrammarFiles) => {
      for (let ttlGrammarFilename of ttlGrammarFiles) {
        let ttlGrammarFileAbsoulte = this.makeTtlGrammarFilenameAbsoulute(ttlGrammarFilename);
        fs.unlink(ttlGrammarFileAbsoulte);
      }
    });

  }
};
