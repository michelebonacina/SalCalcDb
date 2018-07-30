'use strict';

var mongoose = require('mongoose');

// create person schema
var personSchema = new mongoose.Schema(
    {
        surname: { type: String, required: true },      // person's surname
        name: { type: String, required: true },         // person's name
        birthdate: { type: Date },                      // person's birthdate
    },
    {
        collection: 'persons',                          // list of person
    }
);

// export person definition
module.exports = mongoose.model('Person', personSchema);