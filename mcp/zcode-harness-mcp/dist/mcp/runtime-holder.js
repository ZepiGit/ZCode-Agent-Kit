class Holder {
    instance = null;
    set(rt) {
        this.instance = rt;
    }
    get() {
        if (this.instance === null)
            throw new Error("RuntimeManager not initialized");
        return this.instance;
    }
}
export const RuntimeManagerHolder = new Holder();
