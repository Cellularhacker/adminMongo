const _ = require('lodash');
const fs = require('fs');
const path = require('path');

const skippedDbs = ['null', 'admin', 'local'];

// checks for the password in the /config/app.json file if it's set
exports.checkLogin = function (req, res, next){
    const passwordConf = req.nconf.app.get('app');

    // only check for login if a password is specified in the /config/app.json file
    if(passwordConf && Object.prototype.hasOwnProperty.call(passwordConf, ['password'])){
        // dont require login session for login route
        if(req.path === '/app/login' || req.path === '/app/logout' || req.path === '/app/login_action'){
            next();
        }else{
            // if the session exists we continue, else renter login page
            if(req.session.loggedIn){
                next(); // allow the next route to run
            }else{
                res.redirect(req.app_context + '/app/login');
            }
        }
    }else{
        // no password is set so we continue
        next();
    }
};

// gets some db stats
exports.get_db_status = async (mongo_db) => {
    const adminDb = await mongo_db.admin();
    return await adminDb.serverStatus;
};

// gets the backup dirs
exports.get_backups = async () => {
    const junk = require('junk');
    const backupPath = path.join(__dirname, '../backups');

    const files = fs.readdirSync(backupPath, {encoding: 'utf-8'});
    return files.filter(junk.not);
};

// gets the db stats
exports.get_db_stats = async (mongo_db, db_name) => {
    console.log(new Date().toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'}), 'get_db_stats()', 'db_name =>', db_name);
    const db_obj = {};

    let dbList;

    // if at connection level we loop db's and collections
    if(db_name == null){
        const adminDb = mongo_db.admin();

        dbList = await adminDb.listDatabases();

        if(dbList === undefined){
            return null;
        }
        const values = Object.keys(exports.order_object(dbList.databases));
        const promises = [];
        const skippedDbs = ['null', 'admin', 'local'];
        for(let i = 0; i < values.length; i++){
            const value = values[i];
            // MARK: Skip on skip list.
            if(skippedDbs.indexOf(value.name) >= 0)continue;

            promises.push(async () => {
                const tempDBName = value.name;
                const collList = await mongo_db.db(tempDBName).listCollections().toArray();
                const collObj = {};
                const cleanedCollections = exports.cleanCollections(collList);
                for(let j = 0; j < cleanedCollections.length; j++){
                    const jValue = cleanedCollections[j];
                    const collStat = await mongo_db.db(tempDBName).collection(jValue).stats();
                    collObj[jValue] = {Storage: collStat.size, Documents: collStat.count};
                }
            });
        }

        await Promise.all(promises);

        exports.order_object(dbList.databases);
        return exports.order_object(db_obj);

        // if at DB level, we just grab the collections below
    }

    const collList = await mongo_db.db(db_name).listCollections().toArray();
    const coll_obj = {};
    const clearedCollList = exports.cleanCollections(collList);

    for(let i = 0; i < clearedCollList.length; i++){
        const collName = clearedCollList[i];

        const collStat = await mongo_db.db(db_name).collection(collName).stats();
        coll_obj[collName] = {
            Storage: collStat ? collStat.size : 0,
            Documents: collStat ? collStat.count : 0
        };
    }

    return exports.order_object(db_obj);
};

// gets the Databases
exports.get_db_list = async (uri, mongo_db) => {
    const async = require('async');
    const adminDb = mongo_db.admin();
    const db_arr = [];

    try{
        // if a DB is not specified in the Conn string we try get a list
        if(uri.database === undefined || uri.database === null){
            // try go all admin and get the list of DB's
            const dbList = await adminDb.listDatabases();
            if(dbList !== undefined){
                for(let i = 0; i < dbList.databases.length; i++){
                    const cDb = dbList.databases[i];

                    if(skippedDbs.indexOf(cDb.name) >= 0)continue;
                    db_arr.push(cDb.name);
                }
            }else{
                return null;
            }
        }

        return db_arr;
    }catch(e){
        console.error(e.message);
        exports.order_array(db_arr);
        return db_arr;
    }
};

// Normally you would know how your ID's are stored in your DB. As the _id value which is used to handle
// all document viewing in adminMongo is a parameter we dont know if it is an ObjectId, string or integer. We can check if
// the _id string is a valid MongoDb ObjectId but this does not guarantee it is stored as an ObjectId in the DB. It's most likely
// the value will be an ObjectId (hopefully) so we try that first then go from there
exports.get_id_type = async (mongo, collection, doc_id) => {
    if(doc_id){
        const ObjectID = require('mongodb').ObjectID;
        // if a valid ObjectId we try that, then then try as a string
        if(ObjectID.isValid(doc_id)){
            const doc1 = await mongo.collection(collection).findOne({_id: ObjectID(doc_id)});
            if(doc1){
                // doc_id is an ObjectId
                return{doc_id_type: ObjectID(doc_id), doc: doc1};
            }
            const doc2 = mongo.collection(collection).findOne({_id: doc_id});
            if(doc2){
                // doc_id is string
                return{doc_id_type: doc_id, doc: doc2};
            }
            return{doc_id_type: null, doc: null};
        }

        // if the value is not a valid ObjectId value we try as an integer then as a last resort, a string.
        const doc1 = await mongo.collection(collection).findOne({_id: parseInt(doc_id)});
        if(doc1){
            // doc_id is integer
            return{doc_id_type: parseInt(doc_id), doc: doc1};
        }
        const doc2 = await mongo.collection(collection).findOne({_id: doc_id});
        if(doc2){
            // doc_id is string
            return{doc_id_type: doc_id, doc: doc2};
        }
    }

    return{doc_id_type: null, doc: null};
};

// gets the Databases and collections
exports.get_sidebar_list = async (mongo_db, db_name) => {
    const db_obj = {};

    // if no DB is specified, we get all DBs and collections
    if(db_name == null){
        const adminDb = await mongo_db.admin();
        const dbList = await adminDb.listDatabases();

        if(dbList){
            for(let i = 0; i < dbList.databases.length; i++){
                const cDb = dbList.databases[i];
                if(skippedDbs.indexOf(cDb.name) >= 0)continue;

                const collList = await mongo_db.db(cDb.name).listCollections().toArray();
                const clearedCollList = exports.cleanCollections(collList);
                for(let j = 0; j < clearedCollList.length; j++){
                    db_obj[cDb.name] = exports.cleanCollections(clearedCollList[j]);
                }
            }
        }

        return exports.order_object(db_obj);
    }
    let collections = await mongo_db.db(db_name).listCollections().toArray();
    collections = exports.cleanCollections(collections);
    exports.order_array(collections);
    db_obj[db_name] = collections;
    return db_obj;
};

// order the object by alpha key
exports.order_object = function (unordered){
    const ordered = {};

    if(unordered !== undefined){
        const keys = Object.keys(unordered);
        exports.order_array(keys);
        keys.forEach(function (key){
            ordered[key] = unordered[key];
        });
    }
    return ordered;
};

exports.order_array = function (array){
    if(array){
        array.sort(function (a, b){
            a = a.toLowerCase();
            b = b.toLowerCase();
            if(a === b)return 0;
            if(a > b)return 1;
            return-1;
        });
    }
    return array;
};

// render the error page
exports.render_error = function (res, req, err, conn){
    const connection_list = req.nconf.connections.get('connections');

    let conn_string = '';
    if(connection_list[conn] !== undefined){
        conn_string = connection_list[conn].connection_string;
    }

    res.render('error', {
        message: err,
        conn: conn,
        conn_string: conn_string,
        connection_list: exports.order_object(connection_list),
        helpers: req.handlebars.helpers
    });
};

exports.cleanCollections = function (collection_list){
    const list = [];
    _.each(collection_list, function (item){
        list.push(item.name);
    });
    return list;
};
