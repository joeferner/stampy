export function replaceAsync(str: string, re: RegExp, callback: (...args: string[]) => string | Promise<string>): Promise<string> {
    str = String(str);
    let parts = [];
    let i = 0;
    if (Object.prototype.toString.call(re) == "[object RegExp]") {
        if (re.global) {
            re.lastIndex = i;
        }
        let m;
        while (m = re.exec(str)) {
            const args = m.concat([m.index, m.input]);
            parts.push(str.slice(i, m.index), callback.apply(null, args));
            i = re.lastIndex;
            if (!re.global) {
                break; // for non-global regexes only take the first match
            }
            if (m[0].length == 0) {
                re.lastIndex++;
            }
        }
    } else {
        const reToStr = String(re);
        i = str.indexOf(reToStr);
        parts.push(str.slice(0, i), callback.apply(null, [reToStr, i, str]));
        i += reToStr.length;
    }
    parts.push(str.slice(i));
    return Promise.all(parts).then(function (strings) {
        return strings.join("");
    });
}
