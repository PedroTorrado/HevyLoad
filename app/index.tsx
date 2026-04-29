import { View, ActivityIndicator } from "react-native";

export default function Index() {
    // This root index is just a placeholder. 
    // The logic in _layout.tsx will handle the redirect.
    return (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: "#fff" }}>
            <ActivityIndicator size="large" color="#000" />
        </View>
    );
}
