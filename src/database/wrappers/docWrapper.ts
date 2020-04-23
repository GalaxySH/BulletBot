import _ from 'lodash';
import { Model } from 'mongoose';

import { ExDocument, Keys, OptionalFields } from '../schemas/global';
import { DataWrapper } from './dataWrapper';
import { WrapperSynchronizer } from './wrapperSynchronizer';

/**
 * Advanced loading options for changing fetching behavior
 *
 * @export
 * @interface AdvancedLoadOptions
 * @template Data Data which will be loaded
 */
export interface AdvancedLoadOptions<Data extends Object> {
    /**
     * What fields should be loaded
     *
     * @type {OptionalFields<Data>}
     */
    fields?: OptionalFields<Data>;
    /**
     * If already loaded fields should also be reloaded
     *
     * @type {boolean}
     */
    reload?: boolean;
}

/**
 * Options defining what and how fields should be loaded in a wrapper
 * 
 * @export
 * @template Data Data which will be loaded
 */
export type LoadOptions<Data extends Object> = AdvancedLoadOptions<Data> | OptionalFields<Data>;

/**
 * Wrapper for mongoDB documents. 
 * This class handles what part of the document is already loaded and 
 * general interfacing with the document on the database 
 *
 * @export
 * @class DocWrapper
 * @template Data Object which it wraps
 */
export class DocWrapper<Data extends Object> extends DataWrapper<Data, Partial<Data>> {

    /**
     * Model for document this wrapper holds
     *
     * @type {Model<ExDocument<Data>>}
     * @memberof DocWrapper
     */
    readonly model: Model<ExDocument<Data>>;
    /**
     * Unique query that identifies the document
     *
     * @type {*}
     * @memberof DocWrapper
     */
    readonly uniqueQuery: any;
    /**
     * Fields that are currently loaded
     *
     * @type {Keys<Data>}
     * @memberof DocWrapper
     */
    loadedFields: Keys<Data>;
    /**
     * Synchronizer for active synchronization with database
     *
     * @private
     * @type {WrapperSynchronizer<Data>}
     * @memberof DocWrapper
     */
    private synchronizer?: WrapperSynchronizer<Data>;
    /**
     * If document was deleted from database 
     * (Only tracks deletions after creation of wrapper and assumes that document exists when first created)
     *
     * @type {boolean}
     * @memberof DocWrapper
     */
    removed: boolean;

    /**
     * Creates an instance of DocWrapper.
     * 
     * @param {Model<Data>} model Model of collection where the document is stored in
     * @param {*} uniqueQuery Query conditions for finding the document corresponding to the wrapper 
     * @param {Partial<Data>} obj Already know part of document. All keys in this document will added to loadedFields
     * @param {Keys<Data>} allFields Array of all the fields that the object can have (Use keys<T>() from 'ts-transformer-keys' to get them)
     * @memberof DocWrapper
     */
    constructor(model: Model<ExDocument<Data>>, uniqueQuery: any, obj: Partial<Data>, allFields: Keys<Data>) {
        super(obj, allFields);

        this.model = model;
        this.uniqueQuery = uniqueQuery;
        // @ts-ignore
        this.loadedFields = Object.keys(obj);
        this.removed = false;
    }

    /**
     * Getter generator that first checks if the key is already loaded
     *
     * @protected
     * @param {keyof Data} key Key to generate getter for
     * @returns
     * @memberof DocWrapper
     */
    protected dataGetterGenerator(key: keyof Data) {
        return () => {
            if (!this.isLoaded(key)) {
                console.warn(new Error(`The wrapper property "${key}" has been accessed before being loaded. Please first check if a property is already loaded with "Wrapper.load()".`));
                return undefined;
            }
            return this.data.value[key];
        }
    }

    /**
     * Queries the database for the document corresponding to the wrapper
     *
     * @private
     * @param {Keys<Data>} [fields] What parts of the document should be returned
     * @returns The document if it was found
     * @memberof DocWrapper
     */
    protected getDoc(fields?: Keys<Data>) {
        return this.model.findOne(this.uniqueQuery, Array.isArray(fields) ? fields.join(' ') : undefined).exec();
    }

    /**
     * Checks if the document corresponding to this wrapper exists
     *
     * @returns
     * @memberof DocWrapper
     */
    async docExists() {
        return await this.getDoc([]) ? true : false;
    }

    /**
     * Creates a document for this wrapper with the provided content. 
     * It first checks if there is already a document and if so (by default) doesn't create one. 
     * If overwrite is true and a document already exists it first deletes the old one.
     * 
     * IMPORTANT: This function doesn't check if the document is correct or can actually be found by its uniqueQuery.
     *
     * @param {Data} content The content of the document
     * @param {boolean} [overwrite=false] If it should overwrite the old document (Default false)
     * @returns The created document if it was created
     * @memberof DocWrapper
     */
    async createDoc(content: Data, overwrite = false) {
        let oldDocExists = await this.docExists();
        if (!overwrite && oldDocExists) return undefined;
        if (oldDocExists) await this.model.deleteOne(this.uniqueQuery).exec();
        let doc = new this.model(content);
        this.loadFromObject(content);
        return doc.save();
    }

    /**
     * Loads fields from a provided object. 
     * The object is seen as fully loaded, so undefined fields will also be used.
     *
     * @param {Data} obj The object to load from
     * @param {boolean} [overwrite=true] If already loaded fields should be replaced
     * @returns The resulting data object
     * @memberof DocWrapper
     */
    loadFromObject(obj: Data) {
        this.data.next(obj);
        this.loadedFields = undefined;
        return this;
    }

    /**
     * Merges loaded data with the already loaded data
     *
     * @private
     * @param {Data} obj Data to merge
     * @param {Keys<Data>} fieldsToMerge Fields that should be merged
     * @param {boolean} [overwrite=false] If already loaded fields should be overwritten
     * @returns
     * @memberof DocWrapper
     */
    private mergeData(obj: Data, fieldsToMerge: Keys<Data>, overwrite = false) {
        let tempData = this.cloneData();
        for (const key of fieldsToMerge) {
            if (!overwrite && this.loadedFields.includes(key))
                continue;
            tempData[key] = obj[key];
        }
        this.data.next(tempData);
        return tempData;
    }

    /**
     * Reloads all already loaded fields of the wrapper
     *
     * @param {Keys<Data>} [fields] If set it only reloads those fields (can also be not yet loaded fields)
     * @returns
     * @memberof DocWrapper
     */
    async resync(fields?: Keys<Data>) {
        let result = await this.load({ fields: fields || this.loadedFields, reload: true });
        return result ? this : undefined;
    }

    /**
     * Enables active synchronization. 
     * If synchronizer for specified fields already exist it will only return the synchronizer.
     * Not providing already synced fields will result in them no longer being synchronized.
     *
     * @param {Keys<Data>} [fields] What fields should be synchronized 
     * @returns Synchronizer 
     * @memberof DocWrapper
     */
    enableSync(fields?: Keys<Data>) {
        if (!_.isEqual(_.sortBy(this.synchronizer?.syncedFields), _.sortBy(fields)))
            this.synchronizer = new WrapperSynchronizer(this, fields);
        return this.synchronizer;
    }

    /**
     * Disables active synchronization if not already disabled
     *
     * @returns
     * @memberof DocWrapper
     */
    async disableSync() {
        if (!this.synchronizer) return;
        this.synchronizer.close();
        delete this.synchronizer;
    }

    /**
     * Makes a updateOne call to update the document in the database
     *
     * @private
     * @param {*} doc What should be updated
     * @returns Query as a promise
     * @memberof GuildWrapper
     */
    protected update(doc: any) {
        return this.model.updateOne(this.uniqueQuery, doc).exec();
    }

    /**
     * If the entire document or a specific field is loaded
     *
     * @param {string} [field] What field to check. If not specified the entire document will be checked
     * @returns If the specified part is loaded
     * @memberof DocWrapper
     */
    isLoaded(field?: keyof Data) {
        if (!this.loadedFields) return true;
        if (!field) return false;
        return this.loadedFields.includes(field);
    }

    /**
     * Updates which fields of the wrapper are loaded
     *
     * @private
     * @param {Keys<Data>} [fields] Fields that were newly loaded
     * @returns Which fields weren't loaded before
     * @memberof DocWrapper
     */
    updateLoadedFields(fields?: Keys<Data>) {
        if (!this.loadedFields)
            return [];
        if (!fields)
            fields = this.allFields;
        let newFields = _.difference(fields, this.loadedFields);
        this.loadedFields = this.loadedFields.concat(newFields);
        if (!_.difference(this.loadedFields, this.allFields).length) this.loadedFields = undefined;
        return newFields;
    }

    /**
     * Extracts fields that should be loaded from LoadOptions
     *
     * @private
     * @param {LoadOptions<Data>} options Options to extract fields from
     * @returns {Keys<Data>} Fields that should be loaded
     * @memberof DocWrapper
     */
    private extractFieldsToLoad(options: LoadOptions<Data>): Keys<Data> {
        if (!options) return;
        if (Array.isArray(options)) return options;
        if (typeof options !== 'object') return [options];
        if (options.fields) return [].concat(options.fields);
        return undefined;
    }

    /**
     * Extracts if fields should be reloaded from LoadOptions
     *
     * @private
     * @param {LoadOptions<Data>} options Options to extract it from
     * @returns If fields should be reloaded
     * @memberof DocWrapper
     */
    private extractIfReload(options: LoadOptions<Data>) {
        if (!options) return false;
        // @ts-ignore
        if (options.reload) return true;
        return false;
    }

    /**
     * Loads specified not loaded fields. 
     * If force is true it loads all specified fields regardless of if they are already loaded.
     *
     * @param {LoadOptions<Data>} [options] Options for loading (default loads all fields)
     * @returns Loaded data
     * @memberof DocWrapper
     */
    async load(options?: LoadOptions<Data>) {
        let fields = this.extractFieldsToLoad(options);
        let reload = this.extractIfReload(options);
        let loadFields = this.updateLoadedFields(fields);
        if (!loadFields.length && !reload) return [];
        if (reload) loadFields = fields;

        let doc = await this.getDoc(loadFields);
        if (!doc) return undefined;
        this.mergeData(doc, loadFields || this.allFields, true)

        return loadFields;
    }

    /**
     * Removes the corresponding document from the database
     *
     * @returns
     * @memberof DocWrapper
     */
    remove() {
        this.removed = true;
        return this.model.deleteOne(this.uniqueQuery).exec();
    }

}