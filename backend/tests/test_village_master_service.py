import pytest
from app.services.village_master_service import VillageMasterService, stem


def test_tamil_stemming():
    assert stem("Vilankurichi") == "vilankurici"
    assert stem("Saravanampatti") == "saravanampatti"
    assert stem("Neelambur") == "nilambur"
    assert stem("Coimbatore (South)") == "coimbatore"


def test_village_master_service_loaded():
    vms = VillageMasterService.get_instance()
    assert len(vms.master_list) > 10000
    assert len(vms.coimbatore_villages) > 100


def test_lookup_village_by_name():
    vms = VillageMasterService.get_instance()
    res = vms.lookup_village_by_name("Vilankurichi")
    assert res is not None
    assert res["vname"] == "Vilankurichy"
    assert "Coimbatore" in res["tname"]
    assert res["dname"] == "Coimbatore"


def test_resolve_record_location_by_village():
    vms = VillageMasterService.get_instance()
    res = vms.resolve_record_location(village="Vilankurichi")
    assert res["resolved"] is True
    assert res["village"] == "Vilankurichi"
    assert "Coimbatore" in res["taluk"]
    assert res["district"] == "Coimbatore"


def test_resolve_record_location_already_complete():
    vms = VillageMasterService.get_instance()
    res = vms.resolve_record_location(
        village="Kalapatti",
        taluk="Coimbatore (N)",
        district="Coimbatore"
    )
    assert res["resolved"] is False
    assert res["village"] == "Kalapatti"
    assert res["taluk"] == "Coimbatore (N)"
    assert res["district"] == "Coimbatore"
