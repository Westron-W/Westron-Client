package io.nocturne.client;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.rendering.v1.hud.HudElementRegistry;
import net.minecraft.client.Minecraft;
import net.minecraft.resources.Identifier;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Objects;

public final class NocturneClient implements ClientModInitializer {
    @Override
    public void onInitializeClient() {
        WestronSkinManager.initialize();
        HudElementRegistry.addLast(
            Identifier.fromNamespaceAndPath("westron", "voice_overlay"),
            (graphics, deltaTracker) -> renderVoiceOverlay(graphics)
        );
    }

    private static void renderVoiceOverlay(net.minecraft.client.gui.GuiGraphicsExtractor graphics) {
        Minecraft minecraft = Minecraft.getInstance();
        Path file = minecraft.gameDirectory.toPath()
            .resolve("westron-voice")
            .resolve("overlay.json");
        if (!Files.isRegularFile(file)) return;
        try {
            JsonObject state = JsonParser.parseString(
                Files.readString(file, StandardCharsets.UTF_8)
            ).getAsJsonObject();
            if (!state.has("enabled") || !state.get("enabled").getAsBoolean()) return;
            JsonArray participants = state.has("participants") && state.get("participants").isJsonArray()
                ? state.getAsJsonArray("participants")
                : new JsonArray();
            if (participants.isEmpty()) return;
            JsonArray speaking = state.has("speaking") && state.get("speaking").isJsonArray()
                ? state.getAsJsonArray("speaking")
                : new JsonArray();

            int y = 8;
            for (int i = 0; i < participants.size() && i < 8; i++) {
                String name = Objects.requireNonNull(participants.get(i).getAsString());
                boolean isSpeaking = false;
                for (int s = 0; s < speaking.size(); s++) {
                    if (speaking.get(s).getAsString().equals(name)) {
                        isSpeaking = true;
                        break;
                    }
                }
                int width = Math.max(92, minecraft.font.width(name) + 44);
                graphics.fill(8, y, 8 + width, y + 28, isSpeaking ? 0xE51D6B9F : 0xE50D1118);
                graphics.fill(8, y, 12, y + 28, isSpeaking ? 0xFF70D9AD : 0xFF555B68);
                graphics.text(minecraft.font, name, 18, y + 9, isSpeaking ? 0xFFBCEED8 : 0xFFE4E6EC);
                y += 32;
            }
        } catch (RuntimeException | java.io.IOException exception) {
            // Voice overlay state is optional and is ignored until it becomes valid.
        }
    }
}
