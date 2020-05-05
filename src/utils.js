const RateLimiter = ((qpsLimit) => {
    let queue = [], lastTimeMs = 0, scheduler = undefined;
    const processQueue = () => {
        if (!queue || !queue.length) {
            scheduler = null;
            return;  // nothing to schedule
        }
        const currentTimeMs = +new Date();
        const waitTimeMs = (1000 / qpsLimit) - (currentTimeMs - lastTimeMs);
        if (waitTimeMs > 0) {
            scheduler = setTimeout(processQueue, waitTimeMs);
            return;
        }
        const callback = queue.shift();
        callback().finally(() => {
            lastTimeMs = +new Date();
            scheduler = setTimeout(processQueue, 0);
        });
    };
    return ((callback) => {
        queue.push(callback);
        if (!scheduler) {
            scheduler = setTimeout(processQueue, 0);
        }
    });
});

module.exports = { RateLimiter };