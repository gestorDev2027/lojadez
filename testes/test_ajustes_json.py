"""Os ajustes gravados pelo site antes da correção do JSON (texto com JSON dentro, em camadas) valem no Python."""

import json

from servidor.banco import desembrulhar


def test_abre_as_camadas():
    assert desembrulhar('{"kit1": {"preco_centavos": 2490}}') == {"kit1": {"preco_centavos": 2490}}
    assert desembrulhar(json.dumps(json.dumps("Kit Barbeador com 21 Refis"))) == "Kit Barbeador com 21 Refis"
    assert desembrulhar("22") == 22
    assert desembrulhar("true") is True


def test_texto_comum_e_objeto_ficam_como_estao():
    assert desembrulhar("Kit Barbeador") == "Kit Barbeador"
    assert desembrulhar("3 lâminas") == "3 lâminas"
    assert desembrulhar({"a": 1}) == {"a": 1}
    assert desembrulhar(4) == 4
