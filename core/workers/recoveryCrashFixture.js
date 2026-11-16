"use strict";

// Deliberately crash at startup to exercise worker-pool circuit breaking.
throw new Error("intentional worker crash fixture");
