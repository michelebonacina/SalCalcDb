'use strict';

var mongoose = require('mongoose');

// create user schema
var userSchema = new mongoose.Schema(
    {
        username: { type: String, required: true },     // user's username
        password: { type: String, required: true },     // user's password
    },
    {
        collection: 'users',                            // list of users
    }
);

// export user definition
module.exports = mongoose.model('User', userSchema);