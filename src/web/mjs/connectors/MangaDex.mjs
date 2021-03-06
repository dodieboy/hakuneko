import Connector from '../engine/Connector.mjs';
import Manga from '../engine/Manga.mjs';

export default class MangaDex extends Connector {

    constructor() {
        super();
        super.id = 'mangadex';
        super.label = 'MangaDex';
        this.tags = [ 'manga', 'high-quality', 'multi-lingual' ];
        this.url = 'https://mangadex.org';
        this.api = 'https://api.mangadex.org';
        this.requestOptions.headers.set('x-cookie', 'mangadex_h_toggle=1; mangadex_title_mode=2');
        this.requestOptions.headers.set('x-referer', this.url);
        this.throttleGlobal = 100;
        this.licensedChapterGroups = [
            '4f1de6a2-f0c5-4ac5-bce5-02c7dbb67deb' // MangaPlus
        ];
        this.serverNetwork = [
            'http://s2.mangadex.org/data/',
            'http://s5.mangadex.org/data/',
            'https://uploads.mangadex.org/data/'
        ];
    }

    async _initializeConnector() {
        this.serverNetwork.push('https://reh3tgm2rs8sr.xnvda7fch4zhr.mangadex.network/data/');
        this.serverNetwork.push('https://dj5jn4gz46ea6.xnvda7fch4zhr.mangadex.network/data/');
        console.log(`Added Network Seeds '[ ${this.serverNetwork.join(', ')} ]' to ${this.label}`);
        const request = new Request(this.url, this.requestOptions);
        return Engine.Request.fetchUI(request, '');
    }

    canHandleURI(uri) {
        // See: https://www.reddit.com/r/mangadex/comments/nn584s/list_of_appssites_that_currently_use_the_mangadex/
        return [
            /https?:\/\/mangadex\.org\/title\//,
            /https?:\/\/mangastack\.cf\/manga\//,
            /https?:\/\/manga\.megu\.red\/manga\//,
            /https?:\/\/manga\.ayaya\.red\/manga\//,
            /https?:\/\/(www\.)?chibiview\.app\/manga\//,
            /https?:\/\/simpledex\.github\.io\/#\/manga\//,
            /https?:\/\/cubari\.moe\/read\/mangadex\//
        ].some(regex => regex.test(uri.href));
    }

    async _getMangaFromURI(uri) {
        // NOTE: The MangaDex website is still down, but there are some provisional frontends which can be used for search, copy & paste
        const regexGUID = /[a-fA-F0-9]{8}-([a-fA-F0-9]{4}-){3}[a-fA-F0-9]{12}/;
        const id = (uri.pathname.match(regexGUID) || uri.hash.match(regexGUID))[0].toLowerCase();
        const request = new Request(new URL('/manga/' + id, this.api), this.requestOptions);
        const data = await this.fetchJSON(request);
        return new Manga(this, id, data.data.attributes.title.en);
    }

    async _getMangas() {
        let mangaList = [];
        // NOTE: Due to a limit of 10k results, it is necessary to permutate some filters in order to get as many results as possible
        const queries = [
            { status: 'ongoing', order: 'asc' },
            { status: 'ongoing', order: 'desc' },
            { status: 'completed', order: 'asc' },
            { status: 'completed', order: 'desc' },
            { status: 'hiatus', order: 'asc' },
            { status: 'hiatus', order: 'desc' },
            { status: 'cancelled', order: 'asc' },
            { status: 'cancelled', order: 'desc' }
        ];
        for(let query of queries) {
            for(let page = 0, run = true; run; page++) {
                let mangas = await this._getMangasFromPage(page, query);
                mangas.length > 0 ? mangaList.push(...mangas) : run = false;
            }
        }
        return mangaList;
    }

    async _getMangasFromPage(page, query) {
        if(page > 99) {
            // NOTE: Current limit is 10000 entries, maybe login is required to show more?
            //       => Do not throw an error but return gracefully instead, so at least the partial list is shown
            //console.error('For unknown reasons MangaDex is limiting all lists (e.g. mangas) to a maximum of 10000 entries!');
            return [];
        }
        await this.wait(this.throttleGlobal);
        const uri = new URL('/manga', this.api);
        uri.searchParams.set('limit', 100);
        uri.searchParams.set('offset', 100 * page);
        uri.searchParams.set('status[]', query.status);
        uri.searchParams.set('order[createdAt]', query.order);
        uri.searchParams.append('contentRating[]', 'none');
        uri.searchParams.append('contentRating[]', 'safe');
        uri.searchParams.append('contentRating[]', 'suggestive');
        uri.searchParams.append('contentRating[]', 'erotica');
        uri.searchParams.append('contentRating[]', 'pornographic');
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request, 3);
        return !data.results ? [] : data.results.map(result => {
            // decode html entities
            const title = document.createElement('div');
            title.innerHTML = result.data.attributes.title.en;
            return {
                id: result.data.id,
                title: title.textContent.trim()
            };
        });
    }

    async _getChapters(manga) {
        let chapterList = [];
        for(let page = 0, run = true; run; page++) {
            let chapters = await this._getChaptersFromPage(manga, page);
            chapters.length > 0 ? chapterList.push(...chapters) : run = false;
        }
        return chapterList;
    }

    async _getChaptersFromPage(manga, page) {
        await this.wait(this.throttleGlobal);
        const uri = new URL('/chapter', this.api);
        uri.searchParams.set('limit', 100);
        uri.searchParams.set('offset', 100 * page);
        uri.searchParams.set('manga', manga.id);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request, 3);
        const groupMap = await this._getScanlationGroups(data.results);
        return !data.results ? [] : data.results.map(result => {
            let title = '';
            if(result.data.attributes.volume) { // => string, not a number
                title += 'Vol.' + this._padNum(result.data.attributes.volume, 2);
            }
            if(result.data.attributes.chapter) { // => string, not a number
                title += ' Ch.' + this._padNum(result.data.attributes.chapter, 4);
            }
            if(result.data.attributes.title) {
                title += (title ? ' - ' : '') + result.data.attributes.title;
            }
            if(result.data.attributes.translatedLanguage) {
                title += ' (' + result.data.attributes.translatedLanguage + ')';
            }
            const groups = result.relationships.filter(r => r.type === 'scanlation_group');
            if(groups.length > 0) {
                title += ' [' + groups.map(group => groupMap[group.id]).join(', ') + ']';
            }
            // is any group for this chapter not in the list of licensed groups?
            if(groups.some(group => !this.licensedChapterGroups.includes(group.id))) {
                return {
                    id: result.data.id,
                    title: title.trim(),
                    language: result.data.attributes.translatedLanguage
                };
            } else {
                return false;
            }
        }).filter(chapter => chapter);
    }

    async _getPages(chapter) {
        const uri = new URL('/chapter/' + chapter.id, this.api);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request, 3);
        const server = await this._getServerNode(chapter);
        return data.data.attributes.data.map(file => this.createConnectorURI({
            networkNode: server, // e.g. 'https://foo.bar.mangadex.network:44300/token/data/'
            hash: data.data.attributes.hash, // e.g. '1c41e55e32b21321ff11907469e5c323'
            file: file // e.g. 'x1-216a1435.png'
        }));
    }

    async _handleConnectorURI(payload) {
        const servers = [
            ...this.serverNetwork,
            payload.networkNode
        ];
        for(let node of servers) {
            try {
                const uri = new URL(node + payload.hash + '/' + payload.file);
                const request = new Request(uri, this.requestOptions);
                const response = await fetch(request);
                if(response.status === 200) {
                    const data = await response.blob();
                    return this._blobToBuffer(data);
                }
            } finally {/**/}
        }
        throw new Error('Failed to download image file from MangaDex@Home network!\n' + payload.networkNode);
    }

    async _getScanlationGroups(chapters) {
        const groupList = {};
        let groupIDs = !chapters ? {} : chapters.reduce((accumulator, chapter) => {
            const ids = chapter.relationships.filter(r => r.type === 'scanlation_group').map(g => g.id);
            return accumulator.concat(ids);
        }, []);
        groupIDs = Array.from(new Set(groupIDs));
        if(groupIDs.length > 0) {
            await this.wait(this.throttleGlobal);
            const uri = new URL('/group', this.api);
            uri.search = new URLSearchParams([ [ 'limit', 100 ], ...groupIDs.map(id => [ 'ids[]', id ]) ]).toString();
            const request = new Request(uri, this.requestOptions);
            const data = await this.fetchJSON(request, 3);
            data.results.forEach(result => groupList[result.data.id] = result.data.attributes.name || 'unknown');
        }
        return groupList;
    }

    async _getServerNode(chapter) {
        const uri = new URL('/at-home/server/' + chapter.id, this.api);
        const request = new Request(uri, this.requestOptions);
        const data = await this.fetchJSON(request, 3);
        return data.baseUrl + '/data/';
    }

    _padNum(number, places) {
        /*
         * '17'
         * '17.5'
         * '17-17.5'
         * '17 - 17.5'
         * '17-123456789'
         */
        let range = number.split('-');
        range = range.map(chapter => {
            chapter = chapter.trim();
            let digits = chapter.split('.')[0].length;
            return '0'.repeat(Math.max(0, places - digits)) + chapter;
        });
        return range.join('-');
    }
}