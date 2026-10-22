package io.nocturne.client;

import net.fabricmc.api.ClientModInitializer;

public final class NocturneClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        WestronSkinManager.initialize();
    }
}
