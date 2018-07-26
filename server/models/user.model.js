'use strict';

/********************************
 Dependencies
 ********************************/
var mongoose = require('mongoose');

/********************************
 Create User Schema
 ********************************/
var userSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },
        password: { type: String, required: true },
    },
    {
        collection: 'users',
    }
);

module.exports = mongoose.model('User', userSchema);