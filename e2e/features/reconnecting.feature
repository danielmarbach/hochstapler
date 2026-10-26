Feature: Reconnecting
  Whoever reloads the page or is briefly offline gets back to the same seat.

  Background:
    Given Anna and Ben play a game in Switzerland
    And Anna already owns "Weggisgasse"
    And Anna has cash of 1'850

  Scenario: After a reload everything is still there
    When Anna reloads the page
    Then Anna sees themselves as "Anna (du)"
    And Anna has a balance of 1'850
    And Anna owns "Weggisgasse"

  Scenario: After a connection loss the browser reconnects by itself
    When Anna loses the connection
    Then Anna sees the notice that the connection is lost
    When Anna is back online
    Then Anna no longer sees a connection notice
    And Anna has a balance of 1'850

  Scenario: While offline the actions are paused and say why
    Given it is Anna's turn
    When Anna loses the connection
    Then Anna sees the notice that the connection is lost
    And Anna sees that the actions are paused because of the lost connection
    And Anna cannot roll
    When Anna is back online
    Then Anna no longer sees a connection notice
    And Anna can roll again

  Scenario: A trade draft survives a lost connection and is cleared once it was sent
    Given it is Anna's turn
    When Anna drafts an offer of 120 for Ben
    And Anna loses the connection
    Then Anna cannot send the offer and is told why
    And the offer draft of Anna still shows 120
    When Anna is back online
    And Anna sends the drafted offer
    Then the offer draft of Anna is empty again
