package io.nocturne.client.mixin;

import com.mojang.authlib.GameProfile;
import io.nocturne.client.WestronSkinManager;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.PlayerInfo;
import net.minecraft.client.player.AbstractClientPlayer;
import net.minecraft.client.resources.DefaultPlayerSkin;
import net.minecraft.world.entity.player.PlayerSkin;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(value = AbstractClientPlayer.class, remap = false)
public abstract class AbstractClientPlayerMixin {
    @Inject(method = "getSkin", at = @At("HEAD"), cancellable = true, remap = false)
    private void westron$useCustomSkin(CallbackInfoReturnable<PlayerSkin> cir) {
        GameProfile profile = ((AbstractClientPlayer) (Object) this).getGameProfile();
        if (westron$hasServerSkin(profile)) return;
        PlayerSkin skin = WestronSkinManager.getSkin(profile);
        if (skin != null) {
            cir.setReturnValue(skin);
        }
    }

    private static boolean westron$hasServerSkin(GameProfile profile) {
        var profileTextures = profile.properties().get("textures");
        if (profileTextures.stream().anyMatch(property -> !property.hasSignature())) return true;

        var connection = Minecraft.getInstance().getConnection();
        if (connection == null) return false;
        PlayerInfo playerInfo = connection.getPlayerInfo(profile.id());
        if (playerInfo == null) return false;

        var serverTextures = playerInfo.getProfile().properties().get("textures");
        if (serverTextures.stream().anyMatch(property -> !property.hasSignature())) return true;
        if (!serverTextures.stream().map(property -> property.value()).sorted().toList()
            .equals(profileTextures.stream().map(property -> property.value()).sorted().toList())) {
            return true;
        }

        PlayerSkin serverSkin = playerInfo.getSkin();
        return serverSkin != null && !serverSkin.equals(DefaultPlayerSkin.get(profile));
    }
}
