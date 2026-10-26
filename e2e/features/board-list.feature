Feature: Board list
  Everybody can read the board as a plain list: every field in order, who owns it, what stands on it and who is on it.
  It works without pointing at the 3D board and helps children read the small labels.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse" and "Pilatusstrasse"
    And it is Anna's turn

  Scenario: All fields are listed with owner, buildings and players
    Given on "Weggisgasse" there are 2 houses
    And "Pilatusstrasse" is mortgaged
    When Anna opens the board list
    Then the board list for Anna shows 52 fields
    And the board entry "Weggisgasse" for Anna shows "Anna"
    And the board entry "Weggisgasse" for Anna shows "2 Häuser"
    And the board entry "Pilatusstrasse" for Anna shows "hypothekiert"
    And the board entry for field 0 for Anna shows "Anna"
    And the board entry for field 0 for Anna shows "Ben"

  Scenario: An entry opens the property inspector
    When Anna opens the board list
    And Anna opens the board entry "Weggisgasse"
    Then the property card for Anna shows the owner "Anna"
