package;
import haxe.ds.Option;

enum CoffeeInput {
    StepFrame;
    Pause;
    PlaySlow;
    PlayNormal;
    PlayFast;
    Reset;
    Slot(code: Int);
}

class KeyBindings {
    public static function fromKeyCode(code: Int):Option<CoffeeInput> {
        switch code {
            // The extension defaults use a dedicated function-key cluster so
            // gameplay WASD and arrow controls pass through naturally.
            case 70: return Some(StepFrame); // F
            case 80: return Some(Pause); // P
            case 49: return Some(PlaySlow); // 1
            case 50: return Some(PlayNormal); // 2
            case 51: return Some(PlayFast); // 3
            case 82: return Some(Reset);
            case _: {
                if (code >= 48 && code <= 57) {
                    return Some(Slot(code - 48));
                } else {
                    return None;
                }
            }
        }
    }
}
