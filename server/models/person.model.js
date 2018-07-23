'use strict';

/********************************
 Dependencies
 ********************************/
var mongoose = require('mongoose');

/********************************
 Create Person Schema
 ********************************/
var personSchema = new mongoose.Schema(
    {
        surname: { type: String, required: true },
        name: { type: String, required: true },
        birthdate: { type: Date },
    },
    {
        collection: 'persons',
    }
);

module.exports = mongoose.model('Person', personSchema);